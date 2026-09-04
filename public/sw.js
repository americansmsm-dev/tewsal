/* Service Worker — توصّل PWA (مرحلة ي)
 * كاش خفيف للأصول عشان القشرة تفتح أوفلاين. البيانات نفسها
 * بتيجي من الشبكة، والتحولات الأوفلاين في outbox (localStorage).
 */
/* ⚠️ غيّر رقم النسخة دي مع أي تعديل في الواجهة لازم يوصل فورًا —
   تغييرها بيخلي المتصفح ينزّل service worker جديد، يمسح الكاش القديم
   كله (في activate)، ويسيطر على الصفحات المفتوحة على طول. */
const CACHE = "tewsal-shell-v2";
const SHELL = ["/courier", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST/الـ API متعديش الكاش
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // البيانات من الشبكة دايمًا

  // التنقّل: شبكة الأول، وكاش لو أوفلاين
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/courier").then((r) => r || caches.match(req))));
    return;
  }
  // باقي الأصول: كاش الأول، وحدّثه في الخلفية
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => { if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(req, clone)); } return res; }).catch(() => cached);
      return cached || net;
    })
  );
});
