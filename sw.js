// Service worker: เปิดหน้าเว็บได้แม้ไม่มีสัญญาณ (แสดงไฟล์ที่เก็บไว้ก่อน แล้วอัปเดตเบื้องหลัง)
const CACHE = "cm-trip-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  // เก็บเฉพาะหน้าเว็บเอง และสคริปต์ socket.io จาก CDN — ส่วนซิงค์/คำนวณเส้นทางไปที่เซิร์ฟเวอร์ตรง ๆ
  if (u.origin !== self.location.origin && u.hostname !== "cdn.socket.io") return;
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req, { ignoreSearch: true }).then((hit) => {
        const net = fetch(req)
          .then((res) => { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; })
          .catch(() => hit);
        return hit || net;
      })
    )
  );
});
