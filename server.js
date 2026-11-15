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

const GIST_ID = process.env.GIST_ID || "";
const GIST_TOKEN = process.env.GIST_TOKEN || "";
const GIST_API = process.env.GIST_API || "https://api.github.com";
const GIST_DELAY = process.env.GIST_DEBOUNCE_MS !== undefined ? +process.env.GIST_DEBOUNCE_MS : 15000;
const gh = (method, body) =>
  fetch(GIST_API + "/gists/" + GIST_ID, {
    method,
    headers: {
      Authorization: "Bearer " + GIST_TOKEN,
      Accept: "application/vnd.github+json",
      "User-Agent": "changmai-trip-sync",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
let gistPushed = "";
async function gistLoad() {
  if (!GIST_ID || !GIST_TOKEN) return;
  try {
    const r = await gh("GET");
    if (!r.ok) return console.log("gist load failed", r.status);
    const f = ((await r.json()).files || {})["state.json"];
    if (!f) return;
    const txt = f.truncated && f.raw_url ? await (await fetch(f.raw_url)).text() : f.content;
    const o = JSON.parse(txt);
    if (o && typeof o.state === "string" && (!current || o.at > current.at)) {
      current = { state: o.state, at: o.at };
      gistPushed = JSON.stringify(current);
      fs.writeFile(FILE, gistPushed, () => {});
      console.log("restored state from gist");
    } else if (current) {
      gistPushed = "";
    }
  } catch (e) {
    console.log("gist load error", e.message);
  }
}
async function gistPush() {
  if (!GIST_ID || !GIST_TOKEN || !current) return;
  const j = JSON.stringify(current);
  if (j === gistPushed) return;
  try {
    const r = await gh("PATCH", { files: { "state.json": { content: j } } });
    if (r.ok) gistPushed = j; else console.log("gist push failed", r.status);
  } catch (e) {
    console.log("gist push error", e.message);
  }
}
const loaded = gistLoad();

let timer = null;
let gtimer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.writeFile(FILE, JSON.stringify(current), () => {});
  }, 500);
  if (GIST_ID && GIST_TOKEN) {
    clearTimeout(gtimer);
    gtimer = setTimeout(gistPush, GIST_DELAY);
  }
}
// Render ส่ง SIGTERM ก่อนปิด/รีสตาร์ท: เซฟลงไฟล์และ Gist ทันที
process.on("SIGTERM", async () => {
  try { if (current) fs.writeFileSync(FILE, JSON.stringify(current)); } catch (e) {}
  await gistPush();
  process.exit(0);
});

// ---------- คำนวณระยะ/เวลาขับจาก Google Maps (Routes API) ----------
// ตั้งค่าที่ Render: GOOGLE_MAPS_KEY = API key ที่เปิดใช้ "Routes API" (key อยู่ฝั่งเซิร์ฟเวอร์ ไม่หลุดไปที่หน้าเว็บ)
const GKEY = process.env.GOOGLE_MAPS_KEY || "";
const ROUTES_URL = process.env.ROUTES_URL || "https://routes.googleapis.com/directions/v2:computeRoutes";
// ไม่มี GOOGLE_MAPS_KEY (ไม่ต้องใช้บัตรเครดิต): ใช้ OpenStreetMap แทน — Nominatim หาพิกัด + OSRM คิดเส้นทางขับรถ
const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const OSRM_URL = process.env.OSRM_URL || "https://router.project-osrm.org/route/v1/driving";
const GAP = process.env.NOMINATIM_GAP_MS !== undefined ? +process.env.NOMINATIM_GAP_MS : 1100; // นโยบาย Nominatim: ไม่เกิน 1 ครั้ง/วินาที
const geoCache = new Map();
let geoChain = Promise.resolve();
function geocode(q) {
  if (geoCache.has(q)) return Promise.resolve(geoCache.get(q));
  const job = geoChain.then(async () => {
    if (geoCache.has(q)) return geoCache.get(q);
    const u = NOMINATIM_URL + "?format=json&limit=1&countrycodes=th&q=" + encodeURIComponent(q);
    const r = await fetch(u, { headers: { "User-Agent": "changmai-trip-sync/1.0 (personal trip planner)" } });
    const j = await r.json();
    const pt = Array.isArray(j) && j[0] ? { lat: +j[0].lat, lon: +j[0].lon } : null;
    if (pt) geoCache.set(q, pt);
    if (GAP) await new Promise((ok) => setTimeout(ok, GAP));
    return pt;
  });
  geoChain = job.catch(() => {});
  return job;
}
const LL = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
async function osmLegs(p) {
  const pts = [];
  for (const q of p) {
    const m = LL.exec(q);
    const pt = m ? { lat: +m[1], lon: +m[2] } : await geocode(q);
    if (!pt) { const e = new Error("not_found"); e.place = q; throw e; }
    pts.push(pt);
  }
  const r = await fetch(OSRM_URL + "/" + pts.map((x) => x.lon + "," + x.lat).join(";") + "?overview=false");
  const j = await r.json();
  const legs = j && j.routes && j.routes[0] && j.routes[0].legs;
  if (!r.ok || !Array.isArray(legs) || legs.length !== p.length - 1) throw new Error("route_failed");
  return legs.map((l) => ({ km: l.distance / 1000, min: Math.round(l.duration / 60) }));
}
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(["/route", "/search"], (req, res, next) => {
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
const searchCache = new Map();
// ค้นหาสถานที่ให้เลือก (ฟรี ใช้ OpenStreetMap) — ใช้คิวเดียวกับการหาพิกัด เพื่อไม่เกิน 1 ครั้ง/วินาที
app.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2 || q.length > 80) return res.status(400).json({ error: "bad_query" });
  if (searchCache.has(q)) return res.json({ results: searchCache.get(q) });
  if (limited(req.ip)) return res.status(429).json({ error: "rate_limited" });
  try {
    const out = await new Promise((ok, no) => {
      geoChain = geoChain.then(async () => {
        try {
          const u = NOMINATIM_URL + "?format=json&limit=5&addressdetails=0&accept-language=th&countrycodes=th&q=" + encodeURIComponent(q);
          const r = await fetch(u, { headers: { "User-Agent": "changmai-trip-sync/1.0 (personal trip planner)" } });
          const j = await r.json();
          ok((Array.isArray(j) ? j : []).map((x) => {
            const parts = String(x.display_name || "").split(",").map((t) => t.trim());
            return { name: x.name || parts[0], sub: parts.slice(1, 4).join(", "), lat: +x.lat, lon: +x.lon };
          }));
        } catch (e) { no(e); }
        if (GAP) await new Promise((r2) => setTimeout(r2, GAP));
      });
    });
    searchCache.set(q, out);
    res.json({ results: out });
  } catch (e) {
    res.status(502).json({ error: "search_failed" });
  }
});

const routeCache = new Map(); // ที่เดียวกัน เส้นทางเดิม ไม่ต้องเรียก Google ซ้ำ

app.post("/route", async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: "rate_limited" });
  const p = req.body && req.body.places;
  if (!Array.isArray(p) || p.length < 2 || p.length > 12 ||
      p.some((x) => typeof x !== "string" || !x.trim() || x.length > 120)) {
    return res.status(400).json({ error: "bad_places" });
  }
  const key = p.join("\n");
  if (routeCache.has(key)) return res.json({ legs: routeCache.get(key) });
  if (!GKEY) {
    try {
      const out = await osmLegs(p);
      routeCache.set(key, out);
      return res.json({ legs: out, source: "osm" });
    } catch (e) {
      return res.status(e.message === "not_found" ? 422 : 502).json({ error: e.message === "not_found" ? "not_found" : "google_failed", place: e.place });
    }
  }
  try {
    const wp = (x) => { const m = LL.exec(x); return m ? { location: { latLng: { latitude: +m[1], longitude: +m[2] } } } : { address: x }; };
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
  // รอโหลดข้อมูลสำรองจาก Gist ให้เสร็จก่อน (กันเครื่องลูกข่ายส่งข้อมูลเก่าไปทับตอนเซิร์ฟเวอร์เพิ่งตื่น)
  loaded.then(() =>
    socket.emit("hello", {
      state: current ? current.state : null,
      at: current ? current.at : 0,
    })
  );

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
