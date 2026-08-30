/*
 * ============================================================
 *  اختبار الحمل — مرحلة ك
 * ------------------------------------------------------------
 *  بيقيس سعة السيرفر وزمن الاستجابة تحت ذروة تشغيل:
 *   • عام: الجمهور بيتتبّع شحنات (أعلى مسار حِملًا — بدون دخول)
 *   • داخلي: موظفو العمليات بيفتحوا جدول الشحنات (بجلسة واحدة)
 *
 *  ⚠️ مهم — الدخول مرة واحدة بس في setup():
 *     السيستم بيقفل الحساب بعد محاولات دخول كتير (حماية)، فـ
 *     تسجيل دخول كل iteration بيقفل حساب الأدمن ويبوّظ الاختبار.
 *     بنسجّل دخول واحد ونعيد استخدام الكوكي لكل الـ VUs.
 *
 *  الأهداف (من الخطة): جدول الشحنات p95<300ms · التتبع p95<500ms
 *
 *  التشغيل (محتاج k6 — https://k6.io):
 *    # عام فقط (مفيش دخول — يشتغل دايمًا):
 *    BASE=https://staging...  k6 run scripts/loadtest.js
 *    # مع المسار المؤمّن كمان — مرّر بيانات أدمن staging:
 *    BASE=... LT_USER=admin LT_PASS='<staging-admin-pass>'  k6 run scripts/loadtest.js
 * ============================================================
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE || "http://127.0.0.1:3100";
const USER = __ENV.LT_USER || "";
const PASS = __ENV.LT_PASS || "";
// AWB بصيغة صحيحة (يعدّي فحص الـ check-digit) وأغلب الظن مش موجود →
// بيوصل للبحث الحقيقي ويرجّع 404. عدّله بـ AWB حقيقي لو حابب تقيس الإصابة.
const TRACK_AWB = __ENV.LT_AWB || "T26999999993";

// 404 على التتبع = رد سليم (شحنة مش موجودة) مش فشل — منقولش لـ k6 يحسبها خطأ
http.setResponseCallback(http.expectedStatuses(200, 404));

const listTrend = new Trend("shipments_list_ms", true);
const trackTrend = new Trend("public_track_ms", true);

// تسجيل دخول واحد قبل الاختبار كله، والكوكي بيتوزّع على كل الـ VUs
export function setup() {
  if (!USER || !PASS) {
    console.warn("⚠️ مفيش LT_USER/LT_PASS — هيتشغّل المسار العام بس (التتبع). مرّرهم للمسار المؤمّن.");
    return { cookie: null };
  }
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ username: USER, password: PASS }), {
    headers: { "content-type": "application/json" },
  });
  if (res.status !== 200) {
    console.error(`❌ الدخول فشل (${res.status}: ${res.body}) — المسار المؤمّن هيتلغى`);
    return { cookie: null };
  }
  const cookie = (res.headers["Set-Cookie"] || "").split(";")[0];
  console.log("✅ دخول واحد نجح — الكوكي هيتعاد استخدامه");
  return { cookie };
}

export const options = {
  scenarios: {
    // الجمهور بيتتبّع — 25 متوازيين، بدون دخول (المسار الأعلى حِملًا فعليًا)
    public: {
      executor: "constant-vus",
      exec: "trackFlow",
      vus: 25,
      duration: "60s",
    },
    // موظفو العمليات — بيفتحوا الجدول بجلسة واحدة مشتركة
    ops: {
      executor: "ramping-vus",
      exec: "opsFlow",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 10 },
        { duration: "30s", target: 20 },
        { duration: "15s", target: 0 },
      ],
    },
  },
  thresholds: {
    public_track_ms: ["p(95)<500"],
    shipments_list_ms: ["p(95)<300"],
    http_req_failed: ["rate<0.01"],
  },
};

export function trackFlow() {
  const r = http.get(`${BASE}/api/v1/track/${TRACK_AWB}`);
  trackTrend.add(r.timings.duration);
  check(r, { "تتبع رد سليم": (x) => x.status === 200 || x.status === 404 });
  sleep(1 + Math.random() * 2);
}

export function opsFlow(data) {
  if (!data.cookie) { sleep(3); return; } // مفيش جلسة → المسار المؤمّن متعطّل (بدون لفة فاضية)
  const headers = { cookie: data.cookie, "content-type": "application/json" };
  const r = http.get(`${BASE}/api/v1/shipments?limit=50`, { headers });
  listTrend.add(r.timings.duration);
  check(r, { "الشحنات 200": (x) => x.status === 200 });
  sleep(0.5 + Math.random());
}
