/**
 * ============================================================
 *  اختبار توصيل الرسوم الثلاثة على HTTP
 * ------------------------------------------------------------
 *  أ) EXCHANGE — شحنة استبدال بتحاسب ١٥ ج تلقائيًا، وبتتقيّد
 *     مع التسليم كإيراد إضافي على التاجر.
 *  ب) EXTRA_PACKAGING — رسم يدوي بيضيفه الموظف قبل التسليم،
 *     بيتقيّد مع التسليم. + حواجز (أوتوماتيك مرفوض، مجهول
 *     مرفوض، إلغاء بـ void).
 *  ج) EXPEDITE — رسم تسريع على دفع التسوية، بيتخصم إضافي
 *     من التاجر ويتحوّل إيراد.
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-fees.ts
 * ============================================================
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildHandoverEntry, ACC } from "../src/server/domain/ledger";
import { postEntry, accountBalance } from "../src/server/services/ledger";

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
  const db = drizzle(sql);
  const COURIER = crypto.randomUUID();
  const stamp = Date.now();

  /** إيراد أخرى (REVENUE_OTHER) المقيّد على قيد معيّن (بالمصدر والنوع) */
  async function revOtherOn(sourceType: string, sourceId: string, kind: string): Promise<bigint> {
    const [r] = await sql<{ c: string }[]>`
      SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text AS c
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      JOIN accounts a ON a.id = jl.account_id
      WHERE je.source_type = ${sourceType} AND je.source_id = ${sourceId}::uuid AND je.kind = ${kind}
        AND a.code = 'REVENUE_OTHER'`;
    return BigInt(r!.c);
  }

  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    const [branch] = await sql<{ id: string }[]>`SELECT id FROM branches WHERE code='MAIN'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب الرسوم',${"courier_fee_" + stamp},'x','courier',false)`;

    console.log("\n═══ توصيل الرسوم: EXCHANGE · EXTRA_PACKAGING · EXPEDITE ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-FEE-${stamp % 100000}`, nameAr: "تاجر الرسوم", tier: "t1" })).json.merchant.id;

    // شحنة → تسليم (CAI t1 = ٩٠ شحن)
    async function create(extra: Record<string, unknown> = {}): Promise<string> {
      return (await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: "500", confirm: true, ...extra,
      })).json.id as string;
    }
    async function deliver(id: string, cod = "500") {
      const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-2222-4000-8000-000000000009", courierId: COURIER });
      await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
      await tr({ to: "out_for_delivery", runSheetId: "ffffffff-2222-4000-8000-000000000009", courierId: COURIER });
      await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: cod, method: "cash" } });
    }

    // ─── أ) EXCHANGE ───
    console.log("  ── أ) رسم الاستبدال ──");
    const exId = await create({ serviceType: "exchange" });
    const exFees = (await api("GET", `/api/v1/shipments/${exId}/fees`)).json.fees as Array<Record<string, unknown>>;
    check("٢) شحنة الاستبدال فيها رسم EXCHANGE مخزّن", exFees.some((f) => f.fee_code === "EXCHANGE"), true);
    await deliver(exId);
    check("٣) بعد التسليم اتقيّد الاستبدال إيراد ١٥ ج", (await revOtherOn("shipment", exId, "delivery")).toString(), "1500");

    // ─── ب) EXTRA_PACKAGING (يدوي) ───
    console.log("  ── ب) التغليف الإضافي (يدوي) ──");
    const pkId = await create();
    check("٤) إضافة تغليف إضافي ٢٠ ج → 201", (await api("POST", `/api/v1/shipments/${pkId}/fees`, { feeCode: "EXTRA_PACKAGING", amount: "20" })).status, 201);
    check("   إضافة رسم أوتوماتيك (COD) يدوي → مرفوض 422", (await api("POST", `/api/v1/shipments/${pkId}/fees`, { feeCode: "COD", amount: "10" })).status, 422);
    check("   إضافة رسم مجهول → مرفوض 422", (await api("POST", `/api/v1/shipments/${pkId}/fees`, { feeCode: "NOPE", amount: "10" })).status, 422);
    // رسم تاني ٢٥ ج ونلغيه
    const fee2 = await api("POST", `/api/v1/shipments/${pkId}/fees`, { feeCode: "EXTRA_PACKAGING", amount: "25" });
    check("٥) إلغاء الرسم التاني (void) → نجاح", (await api("POST", `/api/v1/shipments/${pkId}/fees/${fee2.json.feeId}/void`, { reason: "غلط" })).json.voided, true);
    check("   إلغاء تاني لنفس الرسم → مرفوض 422", (await api("POST", `/api/v1/shipments/${pkId}/fees/${fee2.json.feeId}/void`, { reason: "تاني" })).status, 422);
    await deliver(pkId);
    check("٦) بعد التسليم اتقيّد التغليف ٢٠ ج بس (الملغي مادخلش)", (await revOtherOn("shipment", pkId, "delivery")).toString(), "2000");
    // بعد التسليم مينفعش تضيف رسم
    check("   إضافة رسم بعد التسليم → مرفوض 422", (await api("POST", `/api/v1/shipments/${pkId}/fees`, { feeCode: "EXTRA_PACKAGING", amount: "5" })).status, 422);

    // ─── ج) EXPEDITE (على دفع التسوية) ───
    console.log("  ── ج) رسم التسريع على التسوية ──");
    const stId = await create();
    await deliver(stId, "1000");
    // المندوب يسلّم عهدته عشان الكاش يبقى مؤكد
    await db.transaction(async (tx) => {
      const bal = await accountBalance(tx, ACC.courierCash(COURIER));
      await postEntry(tx, buildHandoverEntry({ handoverId: crypto.randomUUID(), courierId: COURIER, branchId: branch!.id, expectedP: bal, receivedP: bal }));
    });
    const run = await api("POST", "/api/v1/settlements", { merchantId });
    check("٧) تسوية اشتغلت", run.status, 201);
    const stlId = run.json.settlementId as string;
    await api("POST", `/api/v1/settlements/${stlId}/approve`);
    const payRes = await api("POST", `/api/v1/settlements/${stlId}/pay`, { method: "bank", reference: "TRX-EXP", expediteFee: "25" });
    check("٨) دفع التسوية مع تسريع ٢٥ ج → paid", payRes.json.status, "paid");
    check("   قيد الدفع فيه إيراد تسريع ٢٥ ج", (await revOtherOn("settlement", stlId, "payout")).toString(), "2500");

    // القيد متوازن
    const [bal] = await sql<{ d: string; c: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p),0)::text AS d, COALESCE(SUM(jl.credit_p),0)::text AS c
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.source_type='settlement' AND je.source_id=${stlId}::uuid AND je.kind='payout'`;
    check("   قيد الدفع متوازن", bal!.d, bal!.c);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الرسوم نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
