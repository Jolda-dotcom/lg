const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const ping = require("ping");
const wol = require("wake_on_lan");
const WebSocket = require("ws");
const { powerOnAll } = require("./power-on-all");
const {
  powerOnDevice,
  powerOffDevice,
  queryDevicePowerState,
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
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
    )`
  );

  const existingColumns = await allAsync(`PRAGMA table_info(devices)`);
  if (!existingColumns.some((column) => column.name === "brand")) {
    await runAsync(`ALTER TABLE devices ADD COLUMN brand TEXT NOT NULL DEFAULT 'generic'`);
  }
  if (!existingColumns.some((column) => column.name === "power_state")) {
    await runAsync(`ALTER TABLE devices ADD COLUMN power_state TEXT NOT NULL DEFAULT 'Off'`);
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

const wakeDevice = async (mac) =>
  new Promise((resolve) => {
    if (!mac) {
      return resolve(false);
    }

    try {
      wol.wake(mac, (err) => {
        resolve(!err);
      });
    } catch (error) {
      console.warn(`Invalid MAC for WOL: ${mac}`, error.message);
      resolve(false);
    }
  });

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
      "UPDATE devices SET status = ?, power_state = ? WHERE id = ?",
      [status, powerState, device.id]
    );
  }

  return { ...device, status, power_state: powerState, powerState };
}

app.use(cors());
app.use(express.json());

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
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Backend radi na http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });