const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const ping = require("ping");
const wol = require("wake_on_lan");
const WebSocket = require("ws");
const cron = require("node-cron");
const { powerOnAll } = require("./power-on-all");
const {
  powerOnDevice,
  powerOffDevice,
  queryDevicePowerState,
  wakeDevice,
  launchWebosApp,
  setWebosMute,
  adjustWebosVolume,
  setWebosVolume,
} = require("./tv-adapter");

const app = express();
const PORT = process.env.PORT || 5000;
const DB_FILE = path.join(__dirname, "data.db");
const JSON_FILE = path.join(__dirname, "devices.json");

const db = new sqlite3.Database(DB_FILE);

const runAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });

const allAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });

const getAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });

async function initDatabase() {
  await runAsync("PRAGMA foreign_keys = ON");

  await runAsync(
    `CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )`
  );

  await runAsync(
    `CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      mac TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT 'generic',
      status TEXT NOT NULL DEFAULT 'Offline',
      power_state TEXT NOT NULL DEFAULT 'Off',
      group_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_active_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
    )`
  );

  await runAsync(
    `CREATE TABLE IF NOT EXISTS device_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      cron TEXT NOT NULL,
      action TEXT NOT NULL,
      action_params TEXT,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
    )`
  );

  await runAsync(
    `CREATE TABLE IF NOT EXISTS schedule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(schedule_id) REFERENCES device_schedules(id) ON DELETE CASCADE
    )`
  );

  const existingColumns = await allAsync(`PRAGMA table_info(devices)`);
  if (!existingColumns.some((column) => column.name === "brand")) {
    await runAsync(`ALTER TABLE devices ADD COLUMN brand TEXT NOT NULL DEFAULT 'generic'`);
  }
  if (!existingColumns.some((column) => column.name === "power_state")) {
    await runAsync(`ALTER TABLE devices ADD COLUMN power_state TEXT NOT NULL DEFAULT 'Off'`);
  }
  if (!existingColumns.some((column) => column.name === "last_active_at")) {
    // SQLite may reject ALTER TABLE ADD COLUMN with non-constant default (CURRENT_TIMESTAMP)
    // Add the column without default, then populate existing rows.
    await runAsync(`ALTER TABLE devices ADD COLUMN last_active_at TEXT`);
    try {
      await runAsync(`UPDATE devices SET last_active_at = CURRENT_TIMESTAMP WHERE last_active_at IS NULL`);
    } catch (e) {
      // ignore if update fails
    }
  }

  const row = await getAsync("SELECT COUNT(*) AS count FROM devices");

  try {
    const data = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));

    for (const device of data) {
      await runAsync(
        `INSERT OR IGNORE INTO devices (id, name, ip, mac, brand, status, power_state) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          device.id,
          device.name,
          device.ip,
          device.mac,
          device.brand || "generic",
          device.status || "Offline",
          device.powerState || device.power_state || "Off",
        ]
      );
    }

    console.log("Imported or verified devices from devices.json into SQLite.");
  } catch (error) {
    console.log("No JSON import performed:", error.message);
  }
}

const POWER_QUERY_TIMEOUT_MS = 4000;

const pingDevice = async (ip) => {
  try {
    const result = await ping.promise.probe(ip, {
      timeout: 2,
    });
    return result.alive;
  } catch {
    return false;
  }
};

const mapWebosPowerState = (payload) => {
  if (!payload || typeof payload.state !== "string") {
    return null;
  }

  const state = payload.state.toLowerCase();
  if (state.includes("active") || state.includes("on")) {
    return "On";
  }
  if (state.includes("inactive") || state.includes("off")) {
    return "Off";
  }

  return null;
};

const queryWebosPowerState = async (ip) => {
  if (!ip) {
    return null;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const ws = new WebSocket(`ws://${ip}:3000`, {
      handshakeTimeout: 3000,
    });

    const finish = (value) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timeout = setTimeout(() => finish(null), POWER_QUERY_TIMEOUT_MS);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "request",
          uri: "ssap://com.webos.service.power/getPowerState",
          id: "powerState",
        })
      );
    });

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.id === "powerState") {
          const mapped = mapWebosPowerState(data.payload || data);
          if (mapped) {
            finish(mapped);
          }
        }
      } catch {
        // ignore invalid websocket messages
      }
    });

    ws.on("error", () => finish(null));
    ws.on("close", () => finish(null));
  });
};

async function refreshStatus(device) {
  const alive = await pingDevice(device.ip);
  const status = alive ? "Online" : "Offline";
  let powerState = device.power_state || device.powerState || "Off";

  if (alive) {
    const queriedState = await queryDevicePowerState(device);
    if (queriedState) {
      powerState = queriedState;
    }
  } else {
    powerState = "Off";
  }

  if (status !== device.status || powerState !== device.power_state) {
    await runAsync(
      "UPDATE devices SET status = ?, power_state = ?, last_active_at = ? WHERE id = ?",
      [
        status,
        powerState,
        alive ? new Date().toISOString() : device.last_active_at || new Date().toISOString(),
        device.id,
      ]
    );
  } else if (alive && !device.last_active_at) {
    await runAsync(
      "UPDATE devices SET last_active_at = ? WHERE id = ?",
      [new Date().toISOString(), device.id]
    );
  }

  return { ...device, status, power_state: powerState, powerState };
}

const scheduledTasks = new Map();

const registerScheduleTask = (schedule) => {
  if (!cron.validate(schedule.cron)) {
    console.warn(`Invalid cron expression for schedule ${schedule.id}: ${schedule.cron}`);
    return;
  }

  const existingTask = scheduledTasks.get(schedule.id);
  if (existingTask) {
    existingTask.stop();
  }

  const task = cron.schedule(schedule.cron, async () => {
    console.log(`🔔 Running schedule ${schedule.id} for device ${schedule.device_id}: ${schedule.action}`);
    try {
      await executeScheduleAction(schedule.id);
    } catch (error) {
      console.error(`Schedule ${schedule.id} failed:`, error);
    }
  });

  scheduledTasks.set(schedule.id, task);
};

const removeScheduleTask = (scheduleId) => {
  const task = scheduledTasks.get(scheduleId);
  if (task) {
    task.stop();
    scheduledTasks.delete(scheduleId);
  }
};

const reloadScheduleTask = async (scheduleId) => {
  try {
    const schedule = await getAsync(
      `SELECT * FROM device_schedules WHERE id = ? AND enabled = 1`,
      [scheduleId]
    );

    removeScheduleTask(scheduleId);

    if (schedule) {
      registerScheduleTask(schedule);
    }
  } catch (error) {
    console.error(`Failed to reload schedule ${scheduleId}:`, error);
  }
};

const loadScheduleTasks = async () => {
  const schedules = await allAsync(`SELECT * FROM device_schedules WHERE enabled = 1`);
  schedules.forEach(registerScheduleTask);
};

const executeScheduleAction = async (scheduleId) => {
  const schedule = await getAsync(
    `SELECT * FROM device_schedules WHERE id = ?`,
    [scheduleId]
  );

  if (!schedule || schedule.enabled !== 1) {
    return;
  }

  const device = await getAsync(`SELECT * FROM devices WHERE id = ?`, [schedule.device_id]);
  if (!device) {
    console.warn(`Schedule ${scheduleId} references missing device ${schedule.device_id}`);
    return;
  }

  let actionParams = {};
  try {
    actionParams = schedule.action_params ? JSON.parse(schedule.action_params) : {};
  } catch (error) {
    console.warn(`Failed to parse action_params for schedule ${scheduleId}:`, error.message);
  }
  // If the schedule contains a sequence of actions, run them in order
  // record run start
  let runRowId = null;
  try {
    const r = await runAsync(`INSERT INTO schedule_runs (schedule_id, status, details) VALUES (?, ?, ?)`, [scheduleId, 'running', null]);
    runRowId = r.lastID;
  } catch (e) {
    // ignore logging errors
  }

  if (Array.isArray(actionParams.sequence) && actionParams.sequence.length > 0) {
    for (const step of actionParams.sequence) {
      const act = step.action;
      const params = step.params || {};
      try {
        switch (act) {
          case "poweron":
            await powerOnDevice(device);
            await runAsync(`UPDATE devices SET power_state = 'On' WHERE id = ?`, [device.id]);

            // wait for the device to report as 'On' before proceeding to next step
            // step.waitForReadyMs can override the default max wait (ms)
            const maxWaitMs = Number(step.waitForReadyMs || 30000);
            const pollInterval = 1000;
            let waited = 0;
            try {
              while (waited < maxWaitMs) {
                const state = await queryDevicePowerState(device);
                if (state && typeof state === "string" && state.toLowerCase().includes("on")) {
                  break;
                }
                await new Promise((r) => setTimeout(r, pollInterval));
                waited += pollInterval;
              }
            } catch (e) {
              // ignore polling errors and continue
            }

            // optional settle delay after ready
            if (step.settleMs && Number(step.settleMs) > 0) {
              await new Promise((r) => setTimeout(r, Number(step.settleMs)));
            }
            break;
          case "poweroff":
            await powerOffDevice(device);
            await runAsync(`UPDATE devices SET power_state = 'Off' WHERE id = ?`, [device.id]);
            break;
          case "restart":
            await wakeDevice(device.mac);
            await runAsync(`UPDATE devices SET power_state = 'On' WHERE id = ?`, [device.id]);
            break;
          case "launchApp":
            await launchWebosApp(device.ip, params.target || params.appId || params.uri);
            break;
          case "mute":
            await setWebosMute(device.ip, true);
            break;
          case "unmute":
            await setWebosMute(device.ip, false);
            break;
          case "volumeUp":
            await adjustWebosVolume(device.ip, "Up");
            break;
          case "volumeDown":
            await adjustWebosVolume(device.ip, "Down");
            break;
          case "setVolume":
            if (typeof params.volume === "number") {
              await setWebosVolume(device.ip, params.volume);
            }
            break;
          default:
            console.warn(`Unknown step action for schedule ${scheduleId}: ${act}`);
        }

        // optional delay after this step (ms)
        if (step.delayMs && Number(step.delayMs) > 0) {
          await new Promise((r) => setTimeout(r, Number(step.delayMs)));
        }
      } catch (err) {
          console.error(`Error executing step ${act} for schedule ${scheduleId}:`, err);
          // log error details
          try {
            if (runRowId) await runAsync(`UPDATE schedule_runs SET status = ?, details = ? WHERE id = ?`, ['failed', JSON.stringify({ step: act, error: String(err) }), runRowId]);
          } catch (e) {}
          // continue to next step
      }
    }
      // all steps finished successfully
      try {
        if (runRowId) await runAsync(`UPDATE schedule_runs SET status = ?, details = ? WHERE id = ?`, ['success', JSON.stringify({ sequence: actionParams.sequence }), runRowId]);
      } catch (e) {}
      return;
  }

  // Fallback: single-action schedules (backwards compatible)
  switch (schedule.action) {
    case "poweron":
      await powerOnDevice(device);
      await runAsync(`UPDATE devices SET power_state = 'On' WHERE id = ?`, [device.id]);
      break;
    case "poweroff":
      await powerOffDevice(device);
      await runAsync(`UPDATE devices SET power_state = 'Off' WHERE id = ?`, [device.id]);
      break;
    case "restart":
      await wakeDevice(device.mac);
      await runAsync(`UPDATE devices SET power_state = 'On' WHERE id = ?`, [device.id]);
      break;
    case "launchApp":
      await launchWebosApp(device.ip, actionParams.target || actionParams.appId || actionParams.uri);
      break;
    case "mute":
      await setWebosMute(device.ip, true);
      break;
    case "unmute":
      await setWebosMute(device.ip, false);
      break;
    case "volumeUp":
      await adjustWebosVolume(device.ip, "Up");
      break;
    case "volumeDown":
      await adjustWebosVolume(device.ip, "Down");
      break;
    case "setVolume":
      if (typeof actionParams.volume === "number") {
        await setWebosVolume(device.ip, actionParams.volume);
      }
      break;
    default:
      console.warn(`Unknown schedule action for schedule ${scheduleId}: ${schedule.action}`);
  }

  // update single-action run status
  try {
    if (runRowId) await runAsync(`UPDATE schedule_runs SET status = ?, details = ? WHERE id = ?`, ['success', JSON.stringify({ action: schedule.action, params: actionParams }), runRowId]);
  } catch (e) {}
};

app.use(cors());
app.use(express.json());

// Request logger for debugging
app.use((req, res, next) => {
  try {
    console.log(`REQ --> ${req.method} ${req.originalUrl}`);
  } catch (e) {}
  next();
});

// Debug route: list registered routes
app.get('/__routes', (req, res) => {
  try {
    const routes = [];
    app._router.stack.forEach((r) => {
      if (r.route && r.route.path) {
        const methods = Object.keys(r.route.methods).join(',').toUpperCase();
        routes.push({ path: r.route.path, methods });
      }
    });
    res.json(routes);
  } catch (e) {
    res.status(500).json({ error: 'failed to list routes' });
  }
});

app.get("/devices", async (req, res) => {
  try {
    const devices = await allAsync(
      `SELECT d.*, d.brand, d.power_state AS powerState, g.name AS groupName FROM devices d
       LEFT JOIN groups g ON d.group_id = g.id
       ORDER BY d.name COLLATE NOCASE`
    );

    const refreshed = await Promise.all(
      devices.map((device) => refreshStatus(device))
    );

    res.json(refreshed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/devices", async (req, res) => {
  try {
    const { name, ip, mac, brand, groupId } = req.body;

    if (!name || !ip || !mac) {
      return res.status(400).json({ error: "Missing device fields." });
    }

    const result = await runAsync(
      `INSERT INTO devices (name, ip, mac, brand, status, power_state, group_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, ip, mac, brand || "generic", "Offline", "Off", groupId || null]
    );

    const device = await getAsync(
      `SELECT d.*, d.power_state AS powerState, g.name AS groupName FROM devices d
       LEFT JOIN groups g ON d.group_id = g.id WHERE d.id = ?`,
      [result.lastID]
    );

    res.json(device);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/devices/:id", async (req, res) => {
  try {
    const { name, ip, mac, brand, groupId } = req.body;

    await runAsync(
      `UPDATE devices SET name = ?, ip = ?, mac = ?, brand = ?, group_id = ? WHERE id = ?`,
      [name, ip, mac, brand || "generic", groupId || null, req.params.id]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/devices/:id", async (req, res) => {
  try {
    await runAsync(`DELETE FROM devices WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/devices/:id/ping", async (req, res) => {
  try {
    const device = await getAsync(`SELECT * FROM devices WHERE id = ?`, [
      req.params.id,
    ]);

    if (!device) {
      return res.status(404).json({ error: "Device not found." });
    }

    const alive = await pingDevice(device.ip);
    const status = alive ? "Online" : "Offline";
    let powerState = device.power_state || device.powerState || "Off";

    if (alive) {
      const queriedState = await queryDevicePowerState(device);
      if (queriedState) {
        powerState = queriedState;
      }
    } else {
      powerState = "Off";
    }

    await runAsync(`UPDATE devices SET status = ?, power_state = ? WHERE id = ?`, [
      status,
      powerState,
      device.id,
    ]);

    res.json({ id: device.id, status, powerState });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.post("/devices/:id/poweroff", async (req, res) => {
  try {
    const device = await getAsync(
      "SELECT * FROM devices WHERE id = ?",
      [req.params.id]
    );

    if (!device) {
      return res.status(404).json({
        error: "Device not found",
      });
    }

    const success = await powerOffDevice(device);
    const newState = success ? "Off" : device.power_state || device.powerState || "Off";

    await runAsync(`UPDATE devices SET power_state = ? WHERE id = ?`, [newState, device.id]);

    console.log(`Power off requested for ${device.name} (${device.ip}) brand=${device.brand} success=${success}`);

    res.json({
      success,
      message: success ? "Power off completed" : "Power off request sent but did not confirm.",
      device: device.name,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.get("/devices/:id/schedules", async (req, res) => {
  try {
    const schedules = await allAsync(
      `SELECT * FROM device_schedules WHERE device_id = ? ORDER BY enabled DESC, id DESC`,
      [req.params.id]
    );

    res.json(
      schedules.map((schedule) => ({
        ...schedule,
        enabled: schedule.enabled === 1,
        action_params: schedule.action_params ? JSON.parse(schedule.action_params) : {},
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/devices/:id/schedules", async (req, res) => {
  try {
    const { cron: cronExpression, action, action_params, actions, description, enabled } = req.body;

    if (!cron.validate(cronExpression)) {
      return res.status(400).json({ error: "Invalid cron expression." });
    }

    // allow either single `action` or an `actions` array for sequences
    let dbAction = action || null;
    let dbActionParams = action_params || null;

    if (Array.isArray(actions) && actions.length > 0) {
      dbAction = "sequence";
      dbActionParams = { sequence: actions };
    }

    if (!dbAction) {
      return res.status(400).json({ error: "Action or actions sequence is required." });
    }

    const result = await runAsync(
      `INSERT INTO device_schedules (device_id, cron, action, action_params, description, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        cronExpression,
        dbAction,
        dbActionParams ? JSON.stringify(dbActionParams) : null,
        description || null,
        enabled ? 1 : 0,
      ]
    );

    const schedule = await getAsync(`SELECT * FROM device_schedules WHERE id = ?`, [result.lastID]);
    if (schedule && schedule.enabled === 1) {
      registerScheduleTask(schedule);
    }

    res.json({
      ...schedule,
      enabled: schedule.enabled === 1,
      action_params: schedule.action_params ? JSON.parse(schedule.action_params) : {},
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/devices/:id/schedules/:scheduleId", async (req, res) => {
  try {
    const { cron: cronExpression, action, action_params, actions, description, enabled } = req.body;

    if (!cron.validate(cronExpression)) {
      return res.status(400).json({ error: "Invalid cron expression." });
    }

    let dbAction = action || null;
    let dbActionParams = action_params || null;
    if (Array.isArray(actions) && actions.length > 0) {
      dbAction = "sequence";
      dbActionParams = { sequence: actions };
    }

    if (!dbAction) {
      return res.status(400).json({ error: "Action or actions sequence is required." });
    }

    await runAsync(
      `UPDATE device_schedules SET cron = ?, action = ?, action_params = ?, description = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND device_id = ?`,
      [
        cronExpression,
        dbAction,
        dbActionParams ? JSON.stringify(dbActionParams) : null,
        description || null,
        enabled ? 1 : 0,
        req.params.scheduleId,
        req.params.id,
      ]
    );

    const schedule = await getAsync(
      `SELECT * FROM device_schedules WHERE id = ?`,
      [req.params.scheduleId]
    );

    if (schedule) {
      removeScheduleTask(schedule.id);
      if (schedule.enabled === 1) {
        registerScheduleTask(schedule);
      }
    }

    res.json({
      ...schedule,
      enabled: schedule.enabled === 1,
      action_params: schedule.action_params ? JSON.parse(schedule.action_params) : {},
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/devices/:id/schedules/:scheduleId", async (req, res) => {
  try {
    await runAsync(`DELETE FROM device_schedules WHERE id = ? AND device_id = ?`, [
      req.params.scheduleId,
      req.params.id,
    ]);

    removeScheduleTask(Number(req.params.scheduleId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger for a schedule (useful for testing)
app.post('/devices/:id/schedules/:scheduleId/trigger', async (req, res) => {
  try {
    const schedule = await getAsync(`SELECT * FROM device_schedules WHERE id = ? AND device_id = ?`, [req.params.scheduleId, req.params.id]);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found for device' });

    console.log(`Manual trigger requested for schedule ${req.params.scheduleId} on device ${req.params.id}`);
    // run asynchronously but respond immediately
    executeScheduleAction(Number(req.params.scheduleId)).catch((e) => console.error('Error executing manual trigger:', e));

    res.json({ triggered: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/devices/:id/schedules/:scheduleId/logs', async (req, res) => {
  try {
    console.log('HANDLER --> logs', req.params);
    const rows = await allAsync(`SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 50`, [req.params.scheduleId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/devices/:id/poweron", async (req, res) => {
  try {
    const device = await getAsync(
      "SELECT * FROM devices WHERE id = ?",
      [req.params.id]
    );

    if (!device) {
      return res.status(404).json({
        error: "Device not found",
      });
    }

    const success = await powerOnDevice(device);
    const newState = success ? "On" : device.power_state || device.powerState || "Off";

    if (success) {
      await runAsync(`UPDATE devices SET power_state = 'On' WHERE id = ?`, [device.id]);
    }

    console.log(`Power on requested for ${device.name} (${device.ip}) brand=${device.brand}`);

    res.json({
      success,
      message: success ? "Power on completed" : "Power on request sent but did not confirm.",
      device: device.name,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.post("/devices/:id/restart", async (req, res) => {
  try {
    const device = await getAsync(
      "SELECT * FROM devices WHERE id = ?",
      [req.params.id]
    );

    if (!device) {
      return res.status(404).json({
        error: "Device not found",
      });
    }

    const restarted = await wakeDevice(device.mac);

    if (restarted) {
      await runAsync(
        `UPDATE devices SET status = 'Online', power_state = 'On' WHERE id = ?`,
        [device.id]
      );
    }

    console.log(`Restart requested for ${device.name} (${device.ip}) brand=${device.brand}`);

    res.json({
      id: device.id,
      name: device.name,
      restarted,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.post("/devices/restart", async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No device IDs provided." });
    }

    const placeholders = ids.map(() => "?").join(",");
    const devices = await allAsync(
      `SELECT * FROM devices WHERE id IN (${placeholders})`,
      ids
    );

    const results = await Promise.all(
      devices.map(async (device) => ({
        id: device.id,
        name: device.name,
        restarted: await wakeDevice(device.mac),
      }))
    );

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/devices/settings", async (req, res) => {
  try {
    const { ids, settings } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No device IDs provided." });
    }

    res.json({ success: true, updated: ids.length, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/devices/poweron-all", async (req, res) => {
  try {
    const results = await powerOnAll();
    await Promise.all(
      results
        .filter((item) => item.poweredOn)
        .map((item) =>
          runAsync(`UPDATE devices SET power_state = 'On' WHERE id = ?`, [item.id])
        )
    );
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/devices/poweroff-all", async (req, res) => {
  try {
    const devices = await allAsync(`SELECT * FROM devices`);

    const results = await Promise.all(
      devices.map(async (device) => {
        const poweredOff = await powerOffDevice(device);
        const newState = poweredOff ? "Off" : device.power_state || device.powerState || "Off";

        await runAsync(`UPDATE devices SET power_state = ? WHERE id = ?`, [newState, device.id]);

        return {
          id: device.id,
          name: device.name,
          brand: device.brand || "generic",
          poweredOff,
        };
      })
    );

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/groups", async (req, res) => {
  try {
    const groups = await allAsync(
      `SELECT g.id, g.name, COUNT(d.id) AS deviceCount
       FROM groups g
       LEFT JOIN devices d ON d.group_id = g.id
       GROUP BY g.id
       ORDER BY g.name COLLATE NOCASE`
    );

    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/groups", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Group name is required." });
    }

    const result = await runAsync(`INSERT INTO groups (name) VALUES (?)`, [name]);
    const group = await getAsync(
      `SELECT id, name, 0 AS deviceCount FROM groups WHERE id = ?`,
      [result.lastID]
    );

    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/groups/:id", async (req, res) => {
  try {
    const { name } = req.body;

    await runAsync(`UPDATE groups SET name = ? WHERE id = ?`, [
      name,
      req.params.id,
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/groups/:id/devices", async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const { deviceIds } = req.body;

    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
      return res.status(400).json({ error: "No device IDs provided." });
    }

    const placeholders = deviceIds.map(() => "?").join(",");
    await runAsync(
      `UPDATE devices SET group_id = ? WHERE id IN (${placeholders})`,
      [groupId, ...deviceIds]
    );

    res.json({ success: true, assigned: deviceIds.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/groups/:id/restart", async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const devices = await allAsync(`SELECT * FROM devices WHERE group_id = ?`, [
      groupId,
    ]);

    const results = await Promise.all(
      devices.map(async (device) => ({
        id: device.id,
        name: device.name,
        restarted: await wakeDevice(device.mac),
      }))
    );

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/groups/:id/poweroff", async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const devices = await allAsync(`SELECT * FROM devices WHERE group_id = ?`, [
      groupId,
    ]);

    const results = await Promise.all(
      devices.map(async (device) => {
        const poweredOff = await powerOffDevice(device);
        const newState = poweredOff ? "Off" : device.power_state || device.powerState || "Off";
        await runAsync(
          `UPDATE devices SET power_state = ?, status = 'Offline' WHERE id = ?`,
          [newState, device.id]
        );
        return {
          id: device.id,
          name: device.name,
          poweredOff,
        };
      })
    );

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/groups/:id/poweron", async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const devices = await allAsync(`SELECT * FROM devices WHERE group_id = ?`, [
      groupId,
    ]);

    const results = await Promise.all(
      devices.map(async (device) => {
        const poweredOn = await wakeDevice(device.mac);
        if (poweredOn) {
          await runAsync(`UPDATE devices SET power_state = 'On' WHERE id = ?`, [device.id]);
        }
        return {
          id: device.id,
          name: device.name,
          poweredOn,
        };
      })
    );

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

initDatabase()
  .then(async () => {
    await loadScheduleTasks();
    // debug: list registered routes
    try {
      const routes = [];
      app._router.stack.forEach((r) => {
        if (r.route && r.route.path) {
          const methods = Object.keys(r.route.methods).join(',').toUpperCase();
          routes.push(`${methods} ${r.route.path}`);
        }
      });
      console.log('Registered routes:\n' + routes.join('\n'));
    } catch (e) {
      // ignore
    }
    app.listen(PORT, () => {
      console.log(`🚀 Backend radi na http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });