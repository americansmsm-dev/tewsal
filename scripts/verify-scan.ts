/**
 * ============================================================
 *  اختبار محطة المسح على HTTP
 * ------------------------------------------------------------
 *  - شحنة picked_up → مسح وارد → at_hub + حدث مسح مسجّل
 *  - إعادة مسحها → «مستلمة قبل كده»
 *  - مسح بوليصة مش موجودة → مرفوض + حدث مسح مرفوض مسجّل
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-scan.ts
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
      VALUES (${COURIER}::uuid,'مندوب المسح',${"courier_scan_" + stamp},'x','courier',false)`;

    console.log("\n═══ محطة المسح ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-SC-${stamp % 100000}`, nameAr: "تاجر المسح", tier: "t1" })).json.merchant.id;

    // شحنة → picked_up
    const shipmentId = (await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "منى", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", confirm: true,
    })).json.id as string;
    const awb = (await sql<{ awb: string }[]>`SELECT awb FROM shipments WHERE id=${shipmentId}::uuid`)[0]!.awb;
    const tr = (b: unknown) => api("POST", `/api/v1/shipments/${shipmentId}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-8888-4000-8000-000000000001", courierId: COURIER });
    await tr({ to: "picked_up" });
    check("٢) الشحنة picked_up", (await sql<{ s: string }[]>`SELECT status AS s FROM shipments WHERE id=${shipmentId}::uuid`)[0]!.s, "picked_up");

    // مسح الوارد
    const scan1 = await api("POST", "/api/v1/scan", { awb, scanType: "inbound" });
    check("٣) مسح الوارد → ok", scan1.json.ok, true);
    check("   الحالة بقت at_hub", scan1.json.status, "at_hub");
    check("   اسم المستلم ظهر", scan1.json.recipientName, "منى");
    check("   الشحنة فعلًا at_hub", (await sql<{ s: string }[]>`SELECT status AS s FROM shipments WHERE id=${shipmentId}::uuid`)[0]!.s, "at_hub");

    // حدث المسح اتسجّل
    const [ev] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM scan_events
      WHERE awb=${awb} AND scan_type='inbound' AND was_rejected=false AND resulting_status='at_hub'`;
    check("٤) حدث المسح اتسجّل", ev!.n >= 1, true);

    // إعادة المسح → مستلمة قبل كده
    const scan2 = await api("POST", "/api/v1/scan", { awb, scanType: "inbound" });
    check("٥) إعادة المسح → مستلمة قبل كده", scan2.json.already, true);
    check("   لسه ok (مش مرفوضة)", scan2.json.rejected, false);

    // مسح بوليصة مش موجودة
    const bogus = "T00000000000";
    const scan3 = await api("POST", "/api/v1/scan", { awb: bogus, scanType: "inbound" });
    check("٦) بوليصة مش موجودة → مرفوض", scan3.json.rejected, true);
    const [rej] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM scan_events WHERE awb=${bogus} AND was_rejected=true AND shipment_id IS NULL`;
    check("   حدث مسح مرفوض اتسجّل", rej!.n >= 1, true);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات المسح نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
