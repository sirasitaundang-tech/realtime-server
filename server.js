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

// ---------- คำนวณระยะ/เวลาขับจาก Google Maps (Routes API) ----------
// ตั้งค่าที่ Render: GOOGLE_MAPS_KEY = API key ที่เปิดใช้ "Routes API" (key อยู่ฝั่งเซิร์ฟเวอร์ ไม่หลุดไปที่หน้าเว็บ)
const GKEY = process.env.GOOGLE_MAPS_KEY || "";
const ROUTES_URL = process.env.ROUTES_URL || "https://routes.googleapis.com/directions/v2:computeRoutes";
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use("/route", (req, res, next) => {
  const o = req.headers.origin;
  if (o && (ORIGIN === "*" || ORIGIN.split(",").map((x) => x.trim()).includes(o))) {
    res.set("Access-Control-Allow-Origin", o);
    res.set("Access-Control-Allow-Headers", "content-type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const hits = new Map(); // กันคนยิงจนโควตา Google หมด: 20 ครั้ง/นาที/IP
function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) { hits.set(ip, { n: 1, reset: now + 60000 }); return false; }
  return ++h.n > 20;
}
const routeCache = new Map(); // ที่เดียวกัน เส้นทางเดิม ไม่ต้องเรียก Google ซ้ำ

app.post("/route", async (req, res) => {
  if (!GKEY) return res.status(503).json({ error: "no_key" });
  if (limited(req.ip)) return res.status(429).json({ error: "rate_limited" });
  const p = req.body && req.body.places;
  if (!Array.isArray(p) || p.length < 2 || p.length > 12 ||
      p.some((x) => typeof x !== "string" || !x.trim() || x.length > 120)) {
    return res.status(400).json({ error: "bad_places" });
  }
  const key = p.join("\n");
  if (routeCache.has(key)) return res.json({ legs: routeCache.get(key) });
  try {
    const wp = (x) => ({ address: x });
    const r = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GKEY,
        "X-Goog-FieldMask": "routes.legs.distanceMeters,routes.legs.duration",
      },
      body: JSON.stringify({
        origin: wp(p[0]),
        destination: wp(p[p.length - 1]),
        intermediates: p.slice(1, -1).map(wp),
        travelMode: "DRIVE",
        languageCode: "th",
        regionCode: "TH",
      }),
    });
    const j = await r.json();
    const legs = j && j.routes && j.routes[0] && j.routes[0].legs;
    if (!r.ok || !Array.isArray(legs) || legs.length !== p.length - 1) {
      return res.status(502).json({ error: "google_failed", detail: (j && j.error && j.error.message) || r.status });
    }
    const out = legs.map((l) => ({
      km: (l.distanceMeters || 0) / 1000,
      min: Math.round(parseInt(String(l.duration || "0"), 10) / 60),
    }));
    routeCache.set(key, out);
    res.json({ legs: out });
  } catch (e) {
    res.status(502).json({ error: "google_failed" });
  }
});

app.get("/", (req, res) => res.send("changmai-sync ok"));
// ใช้ให้ keepalive / Render health check / เทสต์ ตรวจว่าเซิร์ฟเวอร์ยังตอบ
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    clients: io.engine.clientsCount,
    hasState: !!current,
    uptime: Math.round(process.uptime()),
  })
);

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

server.listen(PORT, () => console.log("changmai-sync listening on " + server.address().port));
