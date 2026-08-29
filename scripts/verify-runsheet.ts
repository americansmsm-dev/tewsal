/**
 * ============================================================
 *  اختبار كشوف المناديب على HTTP
 * ------------------------------------------------------------
 *  - شحنة تمشي لحد المخزن (at_hub)
 *  - نفتح كشف لمندوب → ننزّله → الشحنة تخرج للتسليم
 *  - نسلّم الشحنة → نقفل الكشف → تتقيّد عمولة ٥٠ ج
 *  - القيد في القاعدة متوازن ونوعه commission على الكشف
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-runsheet.ts
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
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
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
      VALUES (${COURIER}::uuid,'مندوب الكشف',${"courier_rs_" + stamp},'x','courier',false)`;

    console.log("\n═══ كشوف المناديب ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    const merchantId = (await api("POST", "/api/v1/merchants", {
      code: `M-RS-${stamp % 100000}`, nameAr: "تاجر الكشف", tier: "t1",
    })).json.merchant.id;

    // شحنة كاش → نمشّيها لحد المخزن
    const s = await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "ع", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", codAmount: "1000", confirm: true,
    });
    const shipmentId = s.json.id as string;
    check("٢) اتعملت شحنة", !!shipmentId, true);

    const tr = (b: unknown) => api("POST", `/api/v1/shipments/${shipmentId}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-7777-4000-8000-000000000001", courierId: COURIER });
    await tr({ to: "picked_up" });
    await tr({ to: "at_hub" });
    const [st1] = await sql<{ status: string }[]>`SELECT status FROM shipments WHERE id=${shipmentId}::uuid`;
    check("   الشحنة في المخزن", st1!.status, "at_hub");

    // نفتح كشف للمندوب
    const rs = await api("POST", "/api/v1/run-sheets", { courierId: COURIER });
    check("٣) اتفتح كشف → 201", rs.status, 201);
    const runSheetId = rs.json.runSheetId as string;
    check("   حالة الكشف open", rs.json.status, "open");

    // ننزّل الكشف → الشحنة تخرج للتسليم
    const disp = await api("POST", `/api/v1/run-sheets/${runSheetId}/dispatch`, { shipmentIds: [shipmentId] });
    check("٤) تنزيل الكشف → 1 شحنة", disp.json.dispatched, 1);
    const [st2] = await sql<{ status: string; rs: string }[]>`
      SELECT status, current_run_sheet_id::text AS rs FROM shipments WHERE id=${shipmentId}::uuid`;
    check("   الشحنة خرجت للتسليم", st2!.status, "out_for_delivery");
    check("   الشحنة اتربطت بالكشف", st2!.rs, runSheetId);

    // نسلّم الشحنة
    await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: "1000", method: "cash" } });
    const [st3] = await sql<{ status: string }[]>`SELECT status FROM shipments WHERE id=${shipmentId}::uuid`;
    check("٥) اتسلّمت", st3!.status, "delivered");

    // نقفل الكشف → تتقيّد العمولة
    const close = await api("POST", `/api/v1/run-sheets/${runSheetId}/close`);
    check("٦) قفل الكشف → مسلَّم 1", close.json.deliveredCount, 1);
    check("   عمولة ٥٠ ج", close.json.commission, "50.00 ج");

    // القيد متوازن ونوعه commission على الكشف
    const [entry] = await sql<{ n: number; debit: string; credit: string }[]>`
      SELECT count(*)::int AS n,
             COALESCE(SUM(jl.debit_p),0)::text AS debit, COALESCE(SUM(jl.credit_p),0)::text AS credit
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.source_id = ${runSheetId}::uuid AND je.kind = 'commission'`;
    check("٧) قيد العمولة متوازن", entry!.debit, entry!.credit);
    check("   إجمالي القيد ٥٠ ج", entry!.debit, "5000");

    // إغلاق تاني → مفيش عمولة مكررة (القيد اتقيّد مرة واحدة)
    const close2 = await api("POST", `/api/v1/run-sheets/${runSheetId}/close`);
    check("٨) إعادة القفل مرفوضة (مقفول بالفعل)", close2.status, 422);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الكشوف نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
