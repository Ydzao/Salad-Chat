// chat_relay.js  --  works locally and on Render
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const COOLDOWN_MS = 5000;
const REACT_COOLDOWN_MS = 250;
const MAX_LENGTH = 200;
const HISTORY_SIZE = 300;
// Set DEV_TOKEN in the Render env; clients that send the same token get the "</> Dev" badge.
const DEV_TOKEN = process.env.DEV_TOKEN || "";
// Keep in sync with REACTIONS in the Lua menu.
const ALLOWED_REACTIONS = new Set(["❤️", "😂", "👍", "🔥", "😮", "♾️"]);

const history = [];      // message objects, oldest first
const byId = new Map();  // id -> message
let nextId = 1;
let nextSocketKey = 1;

// Plain HTTP answer so Render's health check and a browser visit get "ok".
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});
const wss = new WebSocketServer({ server });

function reactionsOf(m) {
  const out = {};
  for (const [emoji, users] of m.reactions) {
    if (users.size > 0) out[emoji] = [...users.values()];
  }
  return out;
}

function serialize(m) {
  return JSON.stringify({
    type: "msg",
    id: m.id,
    userId: m.userId,
    name: m.name,
    text: m.text,
    game: m.game,
    ts: m.ts,
    dev: m.dev,
    reply: m.reply,
    reactions: reactionsOf(m),
  });
}

function broadcast(payload) {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on("connection", (socket) => {
  const key = nextSocketKey++;
  let lastSent = 0;
  let lastReact = 0;
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  socket.on("error", () => {});

  // Replay history so a fresh account sees the chat (with current reactions).
  for (const m of history) socket.send(serialize(m));

  socket.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (!data || typeof data !== "object") return;
    const now = Date.now();

    if (data.type === "react") {
      if (now - lastReact < REACT_COOLDOWN_MS) return;
      const m = byId.get(Number(data.id));
      if (!m || typeof data.emoji !== "string" || !ALLOWED_REACTIONS.has(data.emoji)) return;
      lastReact = now;
      let users = m.reactions.get(data.emoji);
      if (!users) { users = new Map(); m.reactions.set(data.emoji, users); }
      if (users.has(key)) users.delete(key);
      else users.set(key, Number(data.userId) || 0);
      if (users.size === 0) m.reactions.delete(data.emoji);
      broadcast(JSON.stringify({ type: "reactions", id: m.id, reactions: reactionsOf(m) }));
      return;
    }

    // Default: a chat message (also accepts the old format without "type").
    if (typeof data.text !== "string") return;
    const text = data.text.trim().slice(0, MAX_LENGTH);
    if (!text) return;
    if (now - lastSent < COOLDOWN_MS) return;
    lastSent = now;

    let reply;
    if (data.reply && typeof data.reply === "object" && typeof data.reply.text === "string") {
      reply = {
        name: String(data.reply.name || "?").slice(0, 32),
        text: data.reply.text.slice(0, 120),
      };
    }
    const m = {
      id: nextId++,
      userId: Number(data.userId) || 0,
      name: String(data.name || "?").slice(0, 32),
      text,
      game: String(data.game || "").slice(0, 48),
      ts: now,
      dev: DEV_TOKEN !== "" && data.token === DEV_TOKEN,
      reply,
      reactions: new Map(),
    };
    history.push(m);
    byId.set(m.id, m);
    if (history.length > HISTORY_SIZE) byId.delete(history.shift().id);
    broadcast(serialize(m));
  });
});

// Drop dead sockets and keep Render's proxy from closing idle ones.
setInterval(() => {
  for (const client of wss.clients) {
    if (!client.isAlive) { client.terminate(); continue; }
    client.isAlive = false;
    client.ping();
  }
}, 30000);

server.listen(PORT, () => console.log("chat relay on port " + PORT));
