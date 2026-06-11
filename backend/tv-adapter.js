const net = require("net");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const wol = require("wake_on_lan");
const ping = require("ping");
const SamsungRemote = require("samsung-remote");
const { sendWebosPowerOff } = require("./power-off-tv");

const CLIENT_KEY_FILE = path.join(__dirname, "webos-client-key.txt");
const POWER_QUERY_TIMEOUT_MS = 4000;

const normalizeBrand = (brand) => {
  if (!brand || typeof brand !== "string") {
    return "generic";
  }
  return brand.trim().toLowerCase();
};

const readWebosClientKey = () => {
  if (process.env.WEBOS_CLIENT_KEY) {
    return process.env.WEBOS_CLIENT_KEY.trim();
  }

  try {
    if (fs.existsSync(CLIENT_KEY_FILE)) {
      return fs.readFileSync(CLIENT_KEY_FILE, "utf8").trim();
    }
  } catch {
    return null;
  }

  return null;
};

const sendWebosRequest = async (ip, payload, permissions = []) =>
  new Promise((resolve) => {
    if (!ip) {
      return resolve(false);
    }

    const clientKey = readWebosClientKey();
    const ws = new WebSocket(`wss://${ip}:3001`, {
      rejectUnauthorized: false,
      handshakeTimeout: 5000,
    });

    const manifest = {
      manifestVersion: 1,
      appVersion: "1.0",
      signed: {
        appId: "com.node.tv-scheduler",
        vendorId: "nodejs",
        timestamp: new Date().toISOString(),
      },
      permissions: permissions.length ? permissions : ["CONTROL_POWER", "CONTROL_AUDIO", "LAUNCH", "LAUNCH_WEBAPP"],
    };

    const handleClose = () => resolve(false);
    const timeout = setTimeout(handleClose, 10000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "register",
          id: "register_0",
          payload: {
            pairingType: "PROMPT",
            manifest,
            ...(clientKey ? { "client-key": clientKey } : {}),
          },
        })
      );
    });

    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message.toString());
        if (msg.type === "registered") {
          ws.send(JSON.stringify(payload));
          return;
        }

        if (msg.type === "response" || msg.type === "error") {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.type !== "error");
        }
      } catch {
        // ignore invalid JSON
      }
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });

const launchWebosApp = async (ip, target) => {
  if (!target) {
    return false;
  }

  return sendWebosRequest(
    ip,
    {
      type: "request",
      id: "launch_app",
      uri: "ssap://system.launcher/open",
      payload: { target },
    },
    ["CONTROL_POWER", "LAUNCH", "LAUNCH_WEBAPP"]
  );
};

const setWebosMute = async (ip, muted) => {
  return sendWebosRequest(
    ip,
    {
      type: "request",
      id: "set_mute",
      uri: "ssap://audio/setMute",
      payload: { mute: muted },
    },
    ["CONTROL_AUDIO"]
  );
};

const adjustWebosVolume = async (ip, direction) => {
  if (!ip) {
    return false;
  }

  const uri = direction === "Up" ? "ssap://audio/volumeUp" : "ssap://audio/volumeDown";
  return sendWebosRequest(
    ip,
    {
      type: "request",
      id: `volume_${direction.toLowerCase()}`,
      uri,
      payload: {},
    },
    ["CONTROL_AUDIO"]
  );
};

const setWebosVolume = async (ip, volume) => {
  if (!ip || typeof volume !== "number") {
    return false;
  }

  return sendWebosRequest(
    ip,
    {
      type: "request",
      id: "set_volume",
      uri: "ssap://audio/setVolume",
      payload: { volume },
    },
    ["CONTROL_AUDIO"]
  );
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

      }
    });

    ws.on("error", () => finish(null));
    ws.on("close", () => finish(null));
  });
};

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

  if (brand === "generic") {
    return sendWebosPowerOff(ip);
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
  sendWebosPowerOff,
  launchWebosApp,
  setWebosMute,
  adjustWebosVolume,
  setWebosVolume,
};
