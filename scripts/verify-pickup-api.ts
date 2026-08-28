/**
 * ============================================================
 *  اختبار وحدة الاستلام على HTTP — قرار ١٠
 * ------------------------------------------------------------
 *  - طلب استلام بـ ٣ أوردرات (<٥) → رسم ٥٠ ج
 *  - إسناد لمندوب → الشحنات pickup_assigned
 *  - تأكيد → picked_up + رسم ٥٠ ج على كشف التاجر
 *  - طلب بـ ٥ أوردرات → رسم صفر
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-pickup-api.ts
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
async function api(method: string, path: string, body?: unknown, auth = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(auth && cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  const s = sc.find((c) => c.startsWith("tewsal_session="));
  if (s) cookie = s.split(";")[0]!;
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  const COURIER = "bbbbbbbb-5555-4000-8000-000000000001";
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب الاستلام','courier_pk','x','courier',false) ON CONFLICT (id) DO NOTHING`;

    console.log("\n═══ وحدة الاستلام — قرار ١٠ ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    const code = `M-PK-${Date.now() % 100000}`;
    const merchantId = (await api("POST", "/api/v1/merchants", { code, nameAr: "تاجر الاستلام", tier: "t1", codEnabled: false })).json.merchant.id;

    // نعمل ٣ شحنات في انتظار الاستلام
    async function makeAwaiting() {
      const s = await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", confirm: true,
      });
      return s.json.id as string;
    }
    const ids = [await makeAwaiting(), await makeAwaiting(), await makeAwaiting()];
    check("٢) اتعملت ٣ شحنات في انتظار الاستلام", ids.every(Boolean), true);

    // طلب استلام بـ ٣ (<٥) → رسم ٥٠ ج
    const pk = await api("POST", "/api/v1/pickups", {
      merchantId, shipmentIds: ids, pickupAddress: "مخزن التاجر — مدينة نصر", governorateId: gov!.id,
    });
    check("٣) طلب استلام → 201", pk.status, 201);
    check("   عدد الأوردرات ٣", pk.json.ordersCount, 3);
    check("   ⚠️ رسم خدمة ٥٠ ج (أقل من ٥)", pk.json.serviceFee, "50.00 ج");
    const pickupId = pk.json.pickupId as string;

    // إسناد لمندوب
    const asg = await api("POST", `/api/v1/pickups/${pickupId}/assign`, { courierId: COURIER });
    check("٤) إسناد لمندوب → 3 شحنات", asg.json.assigned, 3);

    // الشحنات بقت pickup_assigned
    const [st1] = await sql<{ status: string }[]>`SELECT status FROM shipments WHERE id = ${ids[0]!}::uuid`;
    check("   الشحنة بقت pickup_assigned", st1!.status, "pickup_assigned");

    // تأكيد الاستلام → picked_up + رسم على التاجر
    const conf = await api("POST", `/api/v1/pickups/${pickupId}/confirm`);
    check("٥) تأكيد الاستلام → collected", conf.json.status, "collected");
    check("   اتحاسب الرسم", conf.json.feeCharged, true);

    const [st2] = await sql<{ status: string }[]>`SELECT status FROM shipments WHERE id = ${ids[0]!}::uuid`;
    check("   الشحنة بقت picked_up", st2!.status, "picked_up");

    // كشف التاجر: رسم ٥٠ ج خصم عليه (تحت التحصيل سالب)
    const stmt = await api("GET", `/api/v1/merchants/${merchantId}/statement`);
    check("٦) كشف التاجر فيه حركة رسم الاستلام", JSON.stringify(stmt.json).includes("50.00 ج"), true);

    // القيد في القاعدة متوازن ونوعه pickup_fee
    const [entry] = await sql<{ n: number; debit: string; credit: string }[]>`
      SELECT count(*)::int AS n,
             COALESCE(SUM(jl.debit_p),0)::text AS debit, COALESCE(SUM(jl.credit_p),0)::text AS credit
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.source_id = ${pickupId}::uuid AND je.kind = 'pickup_fee'`;
    check("٧) قيد رسم الاستلام متوازن", entry!.debit, entry!.credit);
    check("   إجمالي القيد ٥٠ ج", entry!.debit, "5000");

    // طلب استلام بـ ٥ أوردرات → رسم صفر
    const bulk = [await makeAwaiting(), await makeAwaiting(), await makeAwaiting(), await makeAwaiting(), await makeAwaiting()];
    const pk2 = await api("POST", "/api/v1/pickups", {
      merchantId, shipmentIds: bulk, pickupAddress: "مخزن التاجر",
    });
    check("٨) طلب بـ ٥ أوردرات → رسم صفر (مجاني)", pk2.json.serviceFee, "0.00 ج");

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الاستلام نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await sql.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.message : err);
    await sql.end();
    process.exitCode = 1;
  }
}
main();
