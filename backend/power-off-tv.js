const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const KEY_FILE = path.join(__dirname, "webos-client-key.txt");
const savedClientKey = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, "utf8").trim() : "";
const CLIENT_KEY = process.env.WEBOS_CLIENT_KEY || savedClientKey || "22652ac1f80992d654275c4fc3ac3a50";

const sendWebosPowerOff = async (ip) =>
  new Promise((resolve) => {
    if (!ip) {
      console.log("PowerOff: no IP provided");
      return resolve(false);
    }

    console.log(`PowerOff: using client key ${CLIENT_KEY}`);
    
    let completed = false;

    const ws = new WebSocket(`wss://${ip}:3001`, {
      rejectUnauthorized: false,
    });

    const closeConnection = () => {
      if (!completed) {
        completed = true;
        try {
          ws.close();
        } catch (error) {}
        resolve(true);
      }
    };

    ws.on("open", () => {
      console.log("PowerOff: websocket open");
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
        })
      );
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "registered") {
          console.log("PowerOff: registered, sending turnOff");
          ws.send(
            JSON.stringify({
              type: "request",
              id: "poweroff_1",
              uri: "ssap://system/turnOff",
            })
          );
          
          console.log("PowerOff: turnOff sent");
          setTimeout(() => closeConnection(), 3000);
        }
      } catch (e) {}
    });

    ws.on("error", (error) => {
      console.error("PowerOff: websocket error", error.message);
      if (!completed) {
        completed = true;
        resolve(false);
      }
    });

    ws.on("close", () => {
      console.log("PowerOff: websocket closed");
    });

    setTimeout(() => {
      if (!completed) {
        completed = true;
        try {
          ws.close();
        } catch (error) {}
        resolve(false);
      }
    }, 8000);
  });

module.exports = {
  sendWebosPowerOff,
};
