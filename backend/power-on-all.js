const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { powerOnDevice } = require("./tv-adapter");

const DB_FILE = path.join(__dirname, "data.db");
const db = new sqlite3.Database(DB_FILE);

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

async function powerOnAll() {
  const devices = await allAsync(
    `SELECT id, name, ip, mac, brand FROM devices ORDER BY name COLLATE NOCASE`
  );

  const results = await Promise.all(
    devices.map(async (device) => {
      const poweredOn = await powerOnDevice(device);
      if (poweredOn) {
        try {
          await runAsync(`UPDATE devices SET power_state = 'On' WHERE id = ?`, [device.id]);
        } catch (err) {
          console.warn(`Failed to update power_state for device ${device.id}:`, err.message);
        }
      }
      return {
        id: device.id,
        name: device.name,
        ip: device.ip,
        mac: device.mac,
        brand: device.brand,
        poweredOn,
      };
    })
  );

  return results;

}

if (require.main === module) {
  powerOnAll()
    .then((results) => {
      console.log("Power-on results:", JSON.stringify(results, null, 2));
    })
    .catch((error) => {
      console.error("Power-on-all failed:", error);
      process.exit(1);
    })
    .finally(() => db.close());
}

module.exports = { powerOnAll };
