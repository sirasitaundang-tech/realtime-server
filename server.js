// เซิร์ฟเวอร์ซิงค์ทริปเชียงใหม่ (Socket.IO)
// เก็บสถานะทริปทั้งก้อนไว้ที่เดียว แล้วกระจายให้ทุกเครื่องที่เปิดหน้าเว็บอยู่
// ใครมีลิงก์ก็ดูและแก้ได้ ไม่มีการล็อกอิน

const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
// ใส่โดเมนหน้าเว็บของคุณ เช่น https://yourname.github.io (คั่นหลายโดเมนด้วย ,) ไม่ใส่ = อนุญาตทุกที่
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const FILE = process.env.DATA_FILE || path.join(__dirname, "state.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ORIGIN === "*" ? "*" : ORIGIN.split(",").map((s) => s.trim()) },
  maxHttpBufferSize: 1e6,
});

// สถานะล่าสุด { state: "<JSON string>", at: เวลา }
let current = null;
try {
  current = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (e) {
  current = null;
}

let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.writeFile(FILE, JSON.stringify(current), () => {});
  }, 500);
}

app.get("/", (req, res) => res.send("changmai-sync ok"));

io.on("connection", (socket) => {
  // ทุกเครื่องที่ต่อเข้ามาได้สถานะล่าสุดทันที (state = null ถ้ายังไม่มีข้อมูลบนเซิร์ฟเวอร์)
  socket.emit("hello", {
    state: current ? current.state : null,
    at: current ? current.at : 0,
  });

  socket.on("save", (msg, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (!msg || typeof msg.state !== "string" || msg.state.length > 900000) {
      return reply({ ok: false });
    }
    try {
      const o = JSON.parse(msg.state);
      if (!o || !Array.isArray(o.days)) throw new Error("bad state");
    } catch (e) {
      return reply({ ok: false });
    }
    current = { state: msg.state, at: Date.now() };
    persist();
    socket.broadcast.emit("state", { state: current.state, at: current.at });
    reply({ ok: true });
  });
});

server.listen(PORT, () => console.log("changmai-sync listening on " + PORT));
