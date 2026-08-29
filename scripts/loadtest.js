/*
 * ============================================================
 *  اختبار الحمل — مرحلة ك
 * ------------------------------------------------------------
 *  بيحاكي ذروة تشغيل: موظفين بيفتحوا جدول الشحنات + بيمسحوا
 *  باركود + بيتتبّعوا شحنات، عشان نتأكد إن الأهداف متحققة قبل
 *  أي نشر إنتاج (جدول الشحنات < 300ms · تتبع < 500ms).
 *
 *  التشغيل (محتاج k6 — https://k6.io):
 *    BASE=https://staging.tewsal.online  k6 run scripts/loadtest.js
 *  أو محليًا:
 *    BASE=http://127.0.0.1:3100  k6 run scripts/loadtest.js
 * ============================================================
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE || "http://127.0.0.1:3100";
const USER = __ENV.LT_USER || "admin";
const PASS = __ENV.LT_PASS || "Admin12345";

const listTrend = new Trend("shipments_list_ms", true);
const trackTrend = new Trend("public_track_ms", true);

export const options = {
  scenarios: {
    // موظفو عمليات بيفتحوا الجداول ويمسحوا — تصاعد لـ 30 متوازيين
    ops: {
      executor: "ramping-vus",
      exec: "opsFlow",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 10 },
        { duration: "40s", target: 30 },
        { duration: "20s", target: 0 },
      ],
    },
    // جمهور بيتتبّع شحنات (عام، بدون تسجيل دخول)
    public: {
      executor: "constant-vus",
      exec: "trackFlow",
      vus: 15,
      duration: "80s",
    },
  },
  thresholds: {
    shipments_list_ms: ["p(95)<300"], // الهدف المكتوب في الخطة
    public_track_ms: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

// تسجيل دخول مرة واحدة لكل VU وإرجاع الكوكي
function login() {
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ username: USER, password: PASS }), {
    headers: { "content-type": "application/json" },
  });
  const cookie = (res.headers["Set-Cookie"] || "").split(";")[0];
  return cookie;
}

export function opsFlow() {
  const cookie = login();
  const headers = { cookie, "content-type": "application/json" };
  for (let i = 0; i < 5; i++) {
    const r = http.get(`${BASE}/api/v1/shipments?limit=50`, { headers });
    listTrend.add(r.timings.duration);
    check(r, { "الشحنات 200": (x) => x.status === 200 });
    sleep(0.5 + Math.random());
  }
}

export function trackFlow() {
  // AWB وهمي — بنقيس زمن الاستجابة مش وجود الشحنة
  const r = http.get(`${BASE}/api/v1/track/T26000000000`);
  trackTrend.add(r.timings.duration);
  check(r, { "تتبع رد": (x) => x.status === 200 || x.status === 404 });
  sleep(1 + Math.random() * 2);
}
