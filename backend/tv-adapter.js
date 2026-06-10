const net = require("net");
const WebSocket = require("ws");
const wol = require("wake_on_lan");
const ping = require("ping");
const SamsungRemote = require("samsung-remote");

const POWER_QUERY_TIMEOUT_MS = 4000;

const normalizeBrand = (brand) => {
  if (!brand || typeof brand !== "string") {
    return "generic";
  }
  return brand.trim().toLowerCase();
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
    } catch {
      resolve(false);
    }
  });

const pingDevice = async (ip) => {
  if (!ip) {
    return false;
  }

  try {
    const result = await ping.promise.probe(ip, {
      timeout: 2,
    });
    return result.alive;
  } catch {
    return false;
  }
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
          const payload = data.payload || data;
          const state = payload.state || payload.powerState || "";
          if (typeof state === "string") {
            const normalized = state.toLowerCase();
            if (normalized.includes("active") || normalized.includes("on")) {
              finish("On");
              return;
            }
            if (normalized.includes("inactive") || normalized.includes("off")) {
              finish("Off");
              return;
            }
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

const sendWebosPowerOff = async (ip) =>
  new Promise((resolve) => {
    if (!ip) {
      return resolve(false);
    }

    const ws = new WebSocket(`ws://${ip}:3000`, {
      handshakeTimeout: 3000,
    });

    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolve(false);
    }, POWER_QUERY_TIMEOUT_MS);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "request",
          id: "poweroff",
          uri: "ssap://system/turnOff",
        })
      );
    });

    ws.on("message", () => {
      clearTimeout(timeout);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolve(true);
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });

const checkTcpPort = async (ip, port, timeoutMs = 2000) =>
  new Promise((resolve) => {
    if (!ip) {
      return resolve(false);
    }

    const socket = net.createConnection({ host: ip, port, timeout: timeoutMs });
    let resolved = false;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(value);
    };

    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });

const sendSamsungPowerOff = async (ip) =>
  new Promise((resolve) => {
    if (!ip) {
      return resolve(false);
    }

    try {
      const remote = new SamsungRemote({
        ip,
        host: { ip: "127.0.0.1", mac: "00:00:00:00", name: "NodeJS Samsung Remote" },
      });

      remote.send("KEY_POWEROFF", (error) => {
        if (!error) {
          return resolve(true);
        }

        remote.send("KEY_POWER", (fallbackError) => {
          resolve(!fallbackError);
        });
      });
    } catch {
      resolve(false);
    }
  });

const querySamsungPowerState = async (ip) => {
  const portOpen = await checkTcpPort(ip, 55000, 2000);
  if (portOpen) {
    return "On";
  }

  const alive = await ping.promise.probe(ip, { timeout: 2 });
  return alive ? "On" : "Off";
};

const powerOnDevice = async (device) => {
  const brand = normalizeBrand(device.brand);
  const ip = device.ip;
  const mac = device.mac;

  if (brand === "lg" || brand === "webos") {
    return wakeDevice(mac);
  }

  if (brand === "samsung") {
    const alive = await pingDevice(ip);
    if (alive) {
      return true;
    }
    return wakeDevice(mac);
  }

  return wakeDevice(mac);
};

const powerOffDevice = async (device) => {
  const brand = normalizeBrand(device.brand);
  const ip = device.ip;

  if (brand === "lg" || brand === "webos") {
    return sendWebosPowerOff(ip);
  }

  if (brand === "samsung") {
    const alive = await pingDevice(ip);
    if (!alive) {
      return false;
    }
    return sendSamsungPowerOff(ip);
  }

  return false;
};

const queryDevicePowerState = async (device) => {
  const brand = normalizeBrand(device.brand);
  const ip = device.ip;

  if (brand === "lg" || brand === "webos") {
    const state = await queryWebosPowerState(ip);
    if (state) {
      return state;
    }
  }

  if (brand === "samsung") {
    return querySamsungPowerState(ip);
  }

  const alive = await pingDevice(ip);
  return alive ? "On" : "Off";
};

module.exports = {
  normalizeBrand,
  wakeDevice,
  pingDevice,
  powerOnDevice,
  powerOffDevice,
  queryDevicePowerState,
};
