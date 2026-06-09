const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const wol = require("wake_on_lan");

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

const wakeDevice = (mac) =>
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

async function powerOnAll() {
  const devices = await allAsync(
    `SELECT id, name, ip, mac FROM devices WHERE mac IS NOT NULL AND mac != '' ORDER BY name COLLATE NOCASE`
  );

  const results = await Promise.all(
    devices.map(async (device) => ({
      id: device.id,
      name: device.name,
      ip: device.ip,
      mac: device.mac,
      poweredOn: await wakeDevice(device.mac),
    }))
  );
console.log(results)
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
