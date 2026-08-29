/**
 * ============================================================
 *  اختبار سويت التقارير على HTTP
 * ------------------------------------------------------------
 *  ١) المحاسبة: ميزان المراجعة **متوازن** (مدين = دائن)،
 *     والأرباح = الإيراد − المصروف، والإيراد حسب النوع متسق.
 *  ٢) سكوركارد المناديب: التسليم والكاش في العهدة والعمولة صح.
 *  ٣) ربحية التجار: الشحنات والإيراد ونسبة التسليم صح.
 *  ٤) دفتر اليومية بيرجّع القيود.
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-reports.ts
 * ============================================================
 */
import postgres from "postgres";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}
let cookie = "";
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  const s = sc.find((c) => c.startsWith("tewsal_session="));
  if (s) cookie = s.split(";")[0]!;
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  const COURIER = crypto.randomUUID();
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,${"مندوب التقارير " + (stamp % 1000)},${"courier_rep_" + stamp},'x','courier',false)`;

    console.log("\n═══ سويت التقارير والتحليلات ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-REP-${stamp % 100000}`, nameAr: "تاجر التقارير", tier: "t1" })).json.merchant.id;

    async function deliver(cod: string) {
      const id = (await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: cod, confirm: true,
      })).json.id as string;
      const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-5555-4000-8000-000000000009", courierId: COURIER });
      await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
      await tr({ to: "out_for_delivery", runSheetId: "ffffffff-5555-4000-8000-000000000009", courierId: COURIER });
      await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: cod, method: "cash" } });
    }
    await deliver("1000"); await deliver("1000");

    // ─── ١) المحاسبة ───
    console.log("  ── المحاسبة ──");
    const acc = (await api("GET", "/api/v1/reports/accounting")).json;
    check("٢) ميزان المراجعة متوازن", acc.trial.balanced, true);
    check("   إجمالي المدين = إجمالي الدائن", acc.trial.totalDebitP, acc.trial.totalCreditP);
    // الأرباح = الإيراد − المصروف
    const netCalc = (BigInt(acc.pnl.totalRevenueP) - BigInt(acc.pnl.totalExpenseP)).toString();
    check("٣) صافي الربح = الإيراد − المصروف", acc.pnl.netProfitP, netCalc);
    // الإيراد حسب النوع = مجموع صفوفه
    const revSum = (acc.revenue.rows as Array<{ amountP: string }>).reduce((s, r) => s + BigInt(r.amountP), 0n).toString();
    check("٤) إجمالي الإيراد حسب النوع = مجموع الصفوف", acc.revenue.totalP, revSum);
    check("   الإيراد فيه إيراد الشحن", (acc.revenue.rows as Array<{ code: string }>).some((r) => r.code === "REVENUE_SHIPPING"), true);

    // ─── ٢) سكوركارد المناديب ───
    console.log("  ── المناديب ──");
    const couriers = (await api("GET", "/api/v1/reports/couriers")).json.couriers as Array<Record<string, unknown>>;
    const me = couriers.find((c) => c.id === COURIER);
    check("٥) المندوب ظهر في السكوركارد", me ? "موجود" : "غايب", "موجود");
    check("   سلّم شحنتين", me?.deliveredCount, 2);
    check("   التسليم من أول مرة ١٠٠٪", me?.firstAttemptRate, 100);
    check("   كاش العهدة ٢٠٠٠ ج (٢×١٠٠٠ لسه ماتسلّمتش)", me?.cashHeldP, "200000");

    // ─── ٣) ربحية التجار ───
    console.log("  ── التجار ──");
    const merchants = (await api("GET", "/api/v1/reports/merchants")).json.merchants as Array<Record<string, unknown>>;
    const m = merchants.find((x) => x.id === merchantId);
    check("٦) التاجر ظهر في الربحية", m ? "موجود" : "غايب", "موجود");
    check("   شحنتين، الاتنين اتسلّموا", `${m?.shipmentsCount}/${m?.deliveredCount}`, "2/2");
    check("   نسبة التسليم ١٠٠٪", m?.deliveryRate, 100);
    // إيراد = ٢×(٩٠ شحن + ١٠٠ تحصيل) = ٣٨٠ ج
    check("   الإيراد ٣٨٠ ج (شحن + تحصيل)", m?.revenueP, "38000");
    check("   متوسط الإيراد/شحنة ١٩٠ ج", m?.avgRevenuePerDeliveredP, "19000");

    // ─── ٤) دفتر اليومية ───
    console.log("  ── اليومية ──");
    const jrn = (await api("GET", "/api/v1/reports/journal?limit=20")).json;
    check("٧) اليومية بترجّع قيود", Number(jrn.count) > 0, true);
    check("   فيها قيود تسليم", (jrn.journal as Array<{ kind: string }>).some((e) => e.kind === "delivery"), true);

    // صلاحية: المندوب مايشوفش المحاسبة (لو دخلنا بمندوب) — نتأكد إن accounting محمي
    // (بنسيبه — التحقق من الدور متغطّي بـ requireRole)

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات التقارير نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await sql.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await sql.end();
    process.exitCode = 1;
  }
}
main();
