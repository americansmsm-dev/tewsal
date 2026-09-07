/* Service Worker — توصّل PWA (مرحلة ي)
 * كاش خفيف للأصول عشان القشرة تفتح أوفلاين. البيانات نفسها
 * بتيجي من الشبكة، والتحولات الأوفلاين في outbox (localStorage).
 * + إشعارات الدفع (push) على الفون واللاب والتاب.
 */
/* ⚠️ غيّر رقم النسخة دي مع أي تعديل في الواجهة لازم يوصل فورًا —
   تغييرها بيخلي المتصفح ينزّل service worker جديد، يمسح الكاش القديم
   كله (في activate)، ويسيطر على الصفحات المفتوحة على طول. */
const CACHE = "tewsal-shell-v3";
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

/* ============================================================
 *  الإشعارات
 * ============================================================ */

/* نمط اهتزاز مميّز — تعرف إن دي «توصّل» من غير ما تبص على الشاشة */
const VIBRATE = [90, 50, 90, 50, 180];

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = {}; }

  const title = data.title || "توصّل";
  const options = {
    body: data.body || "",
    // ⚠️ لوجو الشركة PNG — تراي أندرويد **مابيعرضش SVG**
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    dir: "rtl",
    lang: "ar",
    vibrate: VIBRATE,
    /* نفس الـtag بيستبدل الإشعار القديم لنفس الشحنة بدل ما يكوّم،
       و renotify بيخلّيه يرنّ تاني مع التحديث */
    tag: data.tag || "tewsal",
    renotify: true,
    /* المهم (فلوس · حاجة بتوقف الشغل) بيقعد فوق لحد ما يتقرا */
    requireInteraction: !!data.urgent,
    data: { url: data.url || "/notifications" },
    actions: [
      { action: "open", title: "افتح" },
      { action: "dismiss", title: "تمام" },
    ],
  };

  e.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      /* التطبيق مفتوح؟ نقول للصفحة تشغّل نغمة الشركة —
         نغمة النظام بتشتغل لوحدها لما يكون مقفول */
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        c.postMessage({ type: "tewsal-push", title, body: options.body, url: options.data.url });
      }
    })()
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "dismiss") return;

  const target = (e.notification.data && e.notification.data.url) || "/notifications";
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      /* التطبيق مفتوح؟ روّح للصفحة المطلوبة بدل ما تفتح تاب جديد */
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) { try { await c.navigate(target); } catch { /* تجاهل */ } }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});

/* المتصفح بيجدّد الاشتراك من نفسه أحيانًا — لازم نبلّغ السيرفر
   وإلا الجهاز بيبقى «مشترك» عندنا وهو مش بيستقبل حاجة */
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const old = e.oldSubscription;
        const key = (old && old.options && old.options.applicationServerKey) || null;
        if (!key) return;
        const fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await fetch("/api/v1/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fresh.toJSON()),
        });
      } catch {
        /* هيتجدّد لما المستخدم يفتح التطبيق تاني */
      }
    })()
  );
});
