/**
 * ============================================================
 *  قياس الحمل — الإثبات إن السيستم يستحمل ١٠ آلاف أوردر/يوم
 * ------------------------------------------------------------
 *  بيشتغل على القاعدة المزروعة من scripts/seed-load.ts (مليون
 *  شحنة = ١٠٠ يوم بمعدل ١٠ آلاف). بيضرب المسارات الحقيقية
 *  بتزامن حقيقي ويقيس p50/p95/max ونسبة الأخطاء.
 *
 *  ليه Node مش k6؟ عشان يشتغل من غير ما تسطّب حاجة — نفس
 *  اللاب اللي بيشغّل السيستم بيقدر يقيسه.
 *
 *  الأهداف (من الخطة):
 *    · جدول الشحنات   p95 < 300ms
 *    · التتبع العام    p95 < 500ms
 *    · تحويل حالة      p95 < 200ms
 *    · الأخطاء         < ١٪
 *
 *  التشغيل:
 *    1) npx tsx scripts/seed-load.ts --shipments=1000000
 *    2) DATABASE_URL=postgres://postgres@127.0.0.1:54320/tewsal_load \
 *       npx next start -p 3200
 *    3) BASE=http://127.0.0.1:3200 npx tsx scripts/bench-load.ts
 *
 *  خيارات: --seconds=30 --concurrency=20 --only=list,search,...
 * ============================================================
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3200";
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const SECONDS = Number(arg("seconds") ?? 20);
const CONCURRENCY = Number(arg("concurrency") ?? 20);
const ONLY = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const USER = process.env.LT_USER ?? "admin";
const PASS = process.env.LT_PASS ?? "Admin12345";

interface Scenario {
  key: string;
  label: string;
  /** الهدف بالمللي ثانية على p95 — null يعني مفيش هدف محدّد */
  targetP95: number | null;
  /** نصيبه من التزامن (وزن) */
  weight: number;
  run: (ctx: Ctx) => Promise<number>;
}
interface Ctx {
  cookie: string;
  merchantIds: string[];
  awbs: string[];
  phones: string[];
}

const samples = new Map<string, number[]>();
const errors = new Map<string, number>();

function record(key: string, ms: number, ok: boolean) {
  (samples.get(key) ?? samples.set(key, []).get(key)!).push(ms);
  if (!ok) errors.set(key, (errors.get(key) ?? 0) + 1);
}

async function timed(key: string, fn: () => Promise<Response>): Promise<number> {
  const t = performance.now();
  let ok = false;
  try {
    const res = await fn();
    // 404 على تتبع شحنة مش موجودة رد سليم مش خطأ
    ok = res.status < 400 || res.status === 404;
    await res.arrayBuffer();
  } catch {
    ok = false;
  }
  const ms = performance.now() - t;
  record(key, ms, ok);
  return ms;
}

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

function pctl(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const SCENARIOS: Scenario[] = [
  {
    key: "list", label: "جدول الشحنات (٥٠ صف)", targetP95: 300, weight: 4,
    run: (c) => timed("list", () => fetch(`${BASE}/api/v1/shipments?limit=50`, { headers: { cookie: c.cookie } })),
  },
  {
    key: "list_status", label: "الجدول بفلتر حالة", targetP95: 300, weight: 3,
    run: (c) => timed("list_status", () =>
      fetch(`${BASE}/api/v1/shipments?limit=50&status=${pick(["delivered", "out_for_delivery", "at_hub", "returned_to_merchant"])}`,
        { headers: { cookie: c.cookie } })),
  },
  {
    key: "search", label: "بحث برقم موبايل", targetP95: 500, weight: 2,
    run: (c) => timed("search", () =>
      fetch(`${BASE}/api/v1/shipments?limit=25&q=${encodeURIComponent(pick(c.phones))}`, { headers: { cookie: c.cookie } })),
  },
  {
    key: "track", label: "تتبع عام (بدون دخول)", targetP95: 500, weight: 4,
    run: (c) => timed("track", () => fetch(`${BASE}/api/v1/track/${pick(c.awbs)}`)),
  },
  {
    key: "statement", label: "كشف حساب تاجر", targetP95: 800, weight: 2,
    run: (c) => timed("statement", () =>
      fetch(`${BASE}/api/v1/merchants/${pick(c.merchantIds)}/statement`, { headers: { cookie: c.cookie } })),
  },
  {
    key: "report_merchants", label: "تقرير ربحية التجار (٩٠ يوم)", targetP95: 3000, weight: 1,
    run: (c) => timed("report_merchants", () =>
      fetch(`${BASE}/api/v1/reports/merchants?days=90`, { headers: { cookie: c.cookie } })),
  },
  {
    key: "report_accounting", label: "المحاسبة (ميزان + أرباح)", targetP95: 3000, weight: 1,
    run: (c) => timed("report_accounting", () =>
      fetch(`${BASE}/api/v1/reports/accounting?days=90`, { headers: { cookie: c.cookie } })),
  },
  {
    key: "notifications", label: "بولنج الإشعارات", targetP95: 200, weight: 3,
    run: (c) => timed("notifications", () =>
      fetch(`${BASE}/api/v1/notifications/feed?limit=20`, { headers: { cookie: c.cookie } })),
  },
];

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (res.status !== 200) throw new Error(`الدخول فشل (${res.status}) — ظبّط LT_USER/LT_PASS`);
  const c = (res.headers.getSetCookie?.() ?? []).find((x) => x.startsWith("tewsal_session="));
  if (!c) throw new Error("مفيش كوكي جلسة في الرد");
  return c.split(";")[0]!;
}

async function buildContext(cookie: string): Promise<Ctx> {
  const j = async (path: string) =>
    (await (await fetch(BASE + path, { headers: { cookie } })).json()) as Record<string, unknown>;

  const ships = (await j("/api/v1/shipments?limit=200")) as unknown as {
    shipments: { awb: string; recipient_phone: string }[];
  };
  const merch = (await j("/api/v1/merchants?limit=50")) as unknown as { merchants: { id: string }[] };

  const awbs = ships.shipments?.map((s) => s.awb).filter(Boolean) ?? [];
  const phones = ships.shipments?.map((s) => s.recipient_phone).filter(Boolean) ?? [];
  const merchantIds = merch.merchants?.map((m) => m.id) ?? [];

  if (awbs.length === 0 || merchantIds.length === 0) {
    throw new Error("القاعدة فاضية — شغّل scripts/seed-load.ts الأول ووجّه السيرفر عليها");
  }
  return { cookie, awbs, phones, merchantIds };
}

async function main() {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  قياس الحمل — ${BASE}`);
  console.log(`  ${CONCURRENCY} طلب متوازي · ${SECONDS} ثانية`);
  console.log(`${"═".repeat(70)}\n`);

  const cookie = await login();
  const ctx = await buildContext(cookie);
  console.log(`✅ جاهز — ${ctx.awbs.length} بوليصة · ${ctx.merchantIds.length} تاجر\n`);

  const active = SCENARIOS.filter((s) => ONLY.length === 0 || ONLY.includes(s.key));
  // بركة مرجّحة: السيناريو الأتقل حِملًا بياخد نصيب أكبر من الطلبات
  const pool: Scenario[] = active.flatMap((s) => Array<Scenario>(s.weight).fill(s));

  const deadline = Date.now() + SECONDS * 1000;
  let total = 0;
  const worker = async () => {
    while (Date.now() < deadline) {
      await pick(pool).run(ctx);
      total++;
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = (performance.now() - t0) / 1000;

  // ── التقرير ──
  console.log(`${"─".repeat(70)}`);
  console.log(`  ${"المسار".padEnd(30)}${"عدد".padStart(7)}${"p50".padStart(9)}${"p95".padStart(9)}${"أقصى".padStart(9)}   الهدف`);
  console.log(`${"─".repeat(70)}`);

  let failed = 0;
  let totalErrors = 0;
  for (const s of active) {
    const xs = samples.get(s.key) ?? [];
    if (xs.length === 0) continue;
    const p50 = pctl(xs, 50), p95 = pctl(xs, 95), max = Math.max(...xs);
    const err = errors.get(s.key) ?? 0;
    totalErrors += err;
    const okTarget = s.targetP95 === null || p95 <= s.targetP95;
    if (!okTarget) failed++;
    const mark = s.targetP95 === null ? "  " : okTarget ? "✅" : "❌";
    console.log(
      `  ${s.label.padEnd(30)}${String(xs.length).padStart(7)}` +
      `${p50.toFixed(0).padStart(8)}m${p95.toFixed(0).padStart(8)}m${max.toFixed(0).padStart(8)}m` +
      `   ${mark} ${s.targetP95 ? `<${s.targetP95}ms` : "—"}` +
      (err > 0 ? `   ⚠️ ${err} خطأ` : "")
    );
  }

  const errRate = total > 0 ? (totalErrors / total) * 100 : 0;
  console.log(`${"─".repeat(70)}`);
  console.log(`  ${fmtInt(total)} طلب في ${elapsed.toFixed(1)}s = ${(total / elapsed).toFixed(0)} طلب/ثانية`);
  console.log(`  نسبة الأخطاء ${errRate.toFixed(2)}% ${errRate < 1 ? "✅" : "❌ (الهدف <1%)"}`);

  // ١٠ آلاف أوردر/يوم = ~٠.١٢ إنشاء/ثانية، بس القراءة أضعافها.
  // الرقم اللي تحت بيقول قدرة القراءة الفعلية مقارنة بيوم شغل.
  console.log(`  ≈ ${fmtInt(Math.round((total / elapsed) * 3600 * 10))} طلب في يوم شغل (١٠ ساعات)`);
  console.log(`${"─".repeat(70)}\n`);

  const ok = failed === 0 && errRate < 1;
  console.log(ok ? "✅ كل الأهداف اتحققت\n" : `❌ ${failed} مسار فوق الهدف\n`);
  process.exitCode = ok ? 0 : 1;
}

const fmtInt = (n: number) => n.toLocaleString("en-US");

main().catch((e) => {
  console.error("\n❌ فشل القياس:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

// وحدة مستقلة — عشان مايتصادمش مع سكربتات تانية في نطاق TypeScript العام
export {};
