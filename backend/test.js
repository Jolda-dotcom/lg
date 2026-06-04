const WebSocket = require("ws");

const CLIENT_KEY = "22652ac1f80992d654275c4fc3ac3a50";

const ws = new WebSocket("wss://192.168.89.65:3001", {
  rejectUnauthorized: false,
});

ws.on("open", () => {
  console.log("CONNECTED");

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

  console.log("REGISTER SENT");
});

ws.on("message", (data) => {
  const text = data.toString();

  console.log("TV RESPONSE:", text);

  try {
    const msg = JSON.parse(text);

    if (msg.type === "registered") {
      console.log("✅ REGISTERED");

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

      console.log("🌐 Browser launch sent");
    }
  } catch (err) {
    console.error(err);
  }
});

ws.on("close", (code, reason) => {
  console.log("CLOSED", code, reason.toString());
});

ws.on("error", (err) => {
  console.error(err);
});
