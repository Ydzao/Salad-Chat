// chat_relay.js  --  works locally and on Render
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const COOLDOWN_MS = 5000;
const MAX_LENGTH = 200;
const HISTORY_SIZE = 300;

// Last messages, replayed to every new connection so a fresh account sees the chat.
const history = [];

// Plain HTTP answer so Render's health check and a browser visit get "ok".
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  let lastSent = 0;
  for (const old of history) socket.send(old);
  socket.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (typeof data.text !== "string") return;
    const text = data.text.trim().slice(0, MAX_LENGTH);
    if (!text) return;
    const now = Date.now();
    if (now - lastSent < COOLDOWN_MS) return;
    lastSent = now;
    const out = JSON.stringify({
      userId: Number(data.userId) || 0,
      name: String(data.name || "?").slice(0, 32),
      text,
    });
    history.push(out);
    if (history.length > HISTORY_SIZE) history.shift();
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(out);
    }
  });
});

server.listen(PORT, () => console.log("chat relay on port " + PORT));
