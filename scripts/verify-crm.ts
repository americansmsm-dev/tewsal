/**
 * اختبار CRM التاجر والعميل (مرحلة ج) على HTTP.
 * BASE=http://127.0.0.1:3100 npx tsx scripts/verify-crm.ts
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
  const stamp = Date.now();
  const PHONE = "01" + String(stamp).slice(-9);
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    const [zone] = await sql<{ id: string }[]>`SELECT id FROM zones WHERE code='cairo_giza'`;

    console.log("\n═══ CRM التاجر والعميل (مرحلة ج) ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-CRM-${stamp % 100000}`, nameAr: "تاجر CRM", tier: "t1" })).json.merchant.id;

    async function makeShipment() {
      return api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "عميل", recipientPhone: PHONE,
        governorateId: gov!.id, addressLine: "المعادي", codAmount: "500",
      });
    }

    // ─── القائمة السوداء ───
    console.log("  ── القائمة السوداء ──");
    check("٢) شحنة للعميل عادي → 201", (await makeShipment()).status, 201);
    check("٣) إضافة العميل للقائمة السوداء → 201", (await api("POST", "/api/v1/blacklist", { phone: PHONE, reason: "رفض متكرر" })).status, 201);
    check("٤) شحنة لعميل في القائمة السوداء → مرفوض 422", (await makeShipment()).status, 422);

    // ─── لوك-أب العميل ───
    console.log("  ── لوك-أب العميل ──");
    const lk = (await api("GET", `/api/v1/customers/lookup?phone=${PHONE}`)).json;
    check("٥) اللوك-أب بيبان عليه القائمة السوداء", lk.blacklisted, true);
    check("   وبيعرض عدد شحناته", lk.total >= 1, true);
    check("   وسبب الحظر", lk.blacklistReason, "رفض متكرر");

    check("٦) شيل العميل من القائمة السوداء", (await api("DELETE", `/api/v1/blacklist/${PHONE}`)).status, 200);
    check("   شحنة تانية بعد الشيل → 201", (await makeShipment()).status, 201);

    // ─── نقاط الولاء ───
    console.log("  ── نقاط الولاء ──");
    check("٧) إضافة ١٠٠ نقطة", (await api("POST", `/api/v1/merchants/${merchantId}/crm`, { action: "points", delta: 100, reason: "مكافأة" })).json.balance, "100");
    check("   استبدال ٣٠ نقطة", (await api("POST", `/api/v1/merchants/${merchantId}/crm`, { action: "points", delta: -30, reason: "استبدال" })).json.balance, "70");
    check("   استبدال أكتر من الرصيد → مرفوض 422", (await api("POST", `/api/v1/merchants/${merchantId}/crm`, { action: "points", delta: -100, reason: "زيادة" })).status, 422);

    // ─── بيانات CRM ───
    console.log("  ── بيانات التاجر ──");
    check("٨) تحديث نوع المنتج", (await api("POST", `/api/v1/merchants/${merchantId}/crm`, { action: "update", productType: "ملابس", allowedWeightKg: "3.00" })).status, 201);
    // ─── سعر خاص ───
    check("٩) سعر خاص للتاجر", (await api("POST", `/api/v1/merchants/${merchantId}/crm`, { action: "override", zoneId: zone!.id, tier: "t1", price: "55" })).status, 201);
    // ─── عنوان استلام ───
    check("١٠) عنوان استلام إضافي", (await api("POST", `/api/v1/merchants/${merchantId}/crm`, { action: "address", label: "المخزن", address: "شارع ٩، المعادي", isDefault: true })).status, 201);

    // GET بيجمّع كله
    const crm = (await api("GET", `/api/v1/merchants/${merchantId}/crm`)).json;
    check("١١) الـ GET بيعرض النقاط ٧٠", crm.merchant.points, "70");
    check("    نوع المنتج اتحدّث", crm.merchant.name_ar ? crm.merchant.product_type : "?", "ملابس");
    check("    السعر الخاص اتسجّل", (crm.overrides as unknown[]).length >= 1, true);
    check("    العنوان الإضافي اتسجّل", (crm.addresses as unknown[]).length >= 1, true);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات CRM نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
