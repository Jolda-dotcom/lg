const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const ping = require("ping");
const wol = require("wake_on_lan");

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
      status TEXT NOT NULL DEFAULT 'Offline',
      group_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
    )`
  );

  const row = await getAsync("SELECT COUNT(*) AS count FROM devices");

  if (row && row.count === 0) {
    try {
      const data = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));

      for (const device of data) {
        await runAsync(
          `INSERT INTO devices (name, ip, mac, status) VALUES (?, ?, ?, ?)`,
          [device.name, device.ip, device.mac, device.status || "Offline"]
        );
      }

      console.log("Imported devices from devices.json into SQLite.");
    } catch (error) {
      console.log("No JSON import performed:", error.message);
    }
  }
}

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

const wakeDevice = async (mac) =>
  new Promise((resolve) => {
    if (!mac) {
      return resolve(false);
    }

    wol.wake(mac, (err) => {
      resolve(!err);
    });
  });

async function refreshStatus(device) {
  const alive = await pingDevice(device.ip);
  const status = alive ? "Online" : "Offline";

  if (status !== device.status) {
    await runAsync("UPDATE devices SET status = ? WHERE id = ?", [
      status,
      device.id,
    ]);
  }

  return { ...device, status };
}

app.use(cors());
app.use(express.json());

app.get("/devices", async (req, res) => {
  try {
    const devices = await allAsync(
      `SELECT d.*, g.name AS groupName FROM devices d
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
    const { name, ip, mac, groupId } = req.body;

    if (!name || !ip || !mac) {
      return res.status(400).json({ error: "Missing device fields." });
    }

    const result = await runAsync(
      `INSERT INTO devices (name, ip, mac, status, group_id) VALUES (?, ?, ?, ?, ?)`,
      [name, ip, mac, "Offline", groupId || null]
    );

    const device = await getAsync(
      `SELECT d.*, g.name AS groupName FROM devices d
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
    const { name, ip, mac, groupId } = req.body;

    await runAsync(
      `UPDATE devices SET name = ?, ip = ?, mac = ?, group_id = ? WHERE id = ?`,
      [name, ip, mac, groupId || null, req.params.id]
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

    await runAsync(`UPDATE devices SET status = ? WHERE id = ?`, [
      status,
      device.id,
    ]);

    res.json({ id: device.id, status });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
