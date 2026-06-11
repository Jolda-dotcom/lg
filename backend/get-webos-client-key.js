const fs = require("fs");
const net = require("net");
const path = require("path");
const WebSocket = require("ws");

const [,, ipArg] = process.argv;
const tvIp = ipArg || process.env.TV_IP;
const KEY_FILE = path.join(__dirname, "webos-client-key.txt");
const clientKey = process.env.WEBOS_CLIENT_KEY;

if (!tvIp) {
  console.error("Usage: node backend/get-webos-client-key.js <TV_IP>");
  process.exit(1);
}

const checkPort = (host, port, timeoutMs = 2000) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.end();
      resolve(true);
    });

    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });

const manifest = {
  manifestVersion: 1,
  appVersion: "1.0",
  signed: {
    appId: "com.node.test",
    vendorId: "node",
    timestamp: new Date().toISOString(),
  },
  permissions: ["CONTROL_POWER"],
};

const run = async () => {
  console.log(`Checking TV ${tvIp} ports...`);

  const port3001Open = await checkPort(tvIp, 3001, 3000);
  const port3000Open = await checkPort(tvIp, 3000, 3000);

  console.log(`Port 3001 open: ${port3001Open}`);
  console.log(`Port 3000 open: ${port3000Open}`);

  if (!port3001Open && !port3000Open) {
    console.error("Neither port 3001 nor 3000 is reachable. Check the TV network and that the TV is on.");
    process.exit(1);
  }

  console.log(`Connecting to TV ${tvIp}...`);

  const ws = new WebSocket(`wss://${tvIp}:3001`, {
    rejectUnauthorized: false,
    handshakeTimeout: 5000,
  });

  ws.on("open", () => {
    console.log("WebSocket opened.");

    const payload = {
      pairingType: "PROMPT",
      manifest,
    };

    if (clientKey) {
      payload["client-key"] = clientKey;
    }

    ws.send(
      JSON.stringify({
        type: "register",
        id: "register_0",
        payload,
      })
    );

    console.log("Register request sent. Check the TV for pairing prompt.");
  });

  ws.on("message", (data) => {
    const text = data.toString();
    console.log("TV RESPONSE:", text);

    try {
      const msg = JSON.parse(text);

      if (msg.type === "registered") {
        const receivedKey = msg.payload?.["client-key"] || msg["client-key"];
        console.log("✅ Registered with TV.");

        if (receivedKey) {
          console.log("CLIENT KEY:", receivedKey);
          try {
            fs.writeFileSync(KEY_FILE, `${receivedKey}\n`, "utf8");
            console.log(`Saved client key to ${KEY_FILE}`);
          } catch (writeError) {
            console.error("Failed to save client key:", writeError.message || writeError);
          }
        } else {
          console.log("No client key received in registered response.");
        }

        setTimeout(() => ws.close(), 2000);
        return;
      }

      if (msg.type === "error") {
        console.error("TV returned error:", msg);
      }
    } catch (err) {
      console.error("Failed to parse TV message:", err.message);
    }
  });

  ws.on("close", (code, reason) => {
    console.log("WebSocket closed", code, reason?.toString() || "");
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message || err);
    process.exit(1);
  });
};

run();
