const cron = require("node-cron");
const wol = require("wake_on_lan");
const WebSocket = require("ws");

const TV_IP = "192.168.89.65";
const TV_MAC = "D8:74:EF:1D:A0:49";
const CLIENT_KEY = "22652ac1f80992d654275c4fc3ac3a50";


cron.schedule("57 6 * * *", () => {
  console.log("🚀 06:57 - Palim TV");

  wol.wake(TV_MAC, (err) => {
    if (err) {
      console.error("WOL greška:", err);
    } else {
      console.log("✅ WOL paket poslan");
    }
  });
});


cron.schedule("0 7 * * *", () => {
  console.log("🌐 07:00 - Otvaram browser");

  const ws = new WebSocket(`wss://${TV_IP}:3001`, {
    rejectUnauthorized: false,
  });

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "register",
        id: "register_0",
        payload: {
          "client-key": CLIENT_KEY,
          pairingType: "PROMPT",
          manifest: {
            manifestVersion: 1,
            appVersion: "1.0",
            signed: {
              appId: "com.node.test",
              vendorId: "node",
              timestamp: new Date().toISOString(),
            },
            permissions: [
              "CONTROL_POWER",
              "CONTROL_AUDIO",
              "LAUNCH",
              "LAUNCH_WEBAPP",
            ],
          },
        },
      }),
    );
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "registered") {
        ws.send(
          JSON.stringify({
            type: "request",
            id: "launch_browser",
            uri: "ssap://system.launcher/open",
            payload: {
              target:
                "https://platforma.herceg.cloud/authentication/device/register",
            },
          }),
        );

        console.log("✅ Browser otvoren");

        setTimeout(() => ws.close(), 3000);
      }
    } catch (e) {}
  });
});


cron.schedule("0 16 * * *", () => {
  console.log("🛑 16:00 - Gasim TV");

  const ws = new WebSocket(`wss://${TV_IP}:3001`, {
    rejectUnauthorized: false,
  });

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "register",
        id: "register_0",
        payload: {
          "client-key": CLIENT_KEY,
          pairingType: "PROMPT",
          manifest: {
            manifestVersion: 1,
            appVersion: "1.0",
            signed: {
              appId: "com.node.test",
              vendorId: "node",
              timestamp: new Date().toISOString(),
            },
            permissions: ["CONTROL_POWER"],
          },
        },
      }),
    );
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "registered") {
        ws.send(
          JSON.stringify({
            type: "request",
            id: "poweroff_1",
            uri: "ssap://system/turnOff",
          }),
        );

        console.log("✅ TV ugašen");

        setTimeout(() => ws.close(), 3000);
      }
    } catch (e) {}
  });
});

console.log("📅 Scheduler pokrenut...");
