/**
 * اختبار الإشعارات والتقييم (مرحلة د).
 * الإشعار fire-and-forget، فبنستنى شوية قبل ما نتأكد من السجل.
 * BASE=http://127.0.0.1:3100 npx tsx scripts/verify-notifications.ts
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  const COURIER = crypto.randomUUID();
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب الإشعارات',${"courier_ntf_" + stamp},'x','courier',false)`;

    console.log("\n═══ الإشعارات والتواصل (مرحلة د) ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-NTF-${stamp % 100000}`, nameAr: "تاجر الإشعارات", tier: "t1" })).json.merchant.id;

    // شحنة → تسليم (كل مرحلة بتطلق إشعار)
    const created = (await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "عميل", recipientPhone: "01099998888",
      governorateId: gov!.id, addressLine: "المعادي", codAmount: "400", confirm: true,
    })).json;
    const id = created.id, awb = created.awb;
    const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-8888-4000-8000-000000000009", courierId: COURIER });
    await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
    await tr({ to: "out_for_delivery", runSheetId: "ffffffff-8888-4000-8000-000000000009", courierId: COURIER });
    await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: "400", method: "cash" } });

    // الإشعار fire-and-forget — نستنى
    await wait(1200);

    console.log("  ── سجل الإشعارات ──");
    const logs = await sql<{ event: string; status: string; body: string }[]>`
      SELECT event, status, body FROM notification_log WHERE shipment_id = ${id}::uuid ORDER BY created_at`;
    check("٢) اتسجّلت إشعارات للشحنة", logs.length > 0, true);
    check("   فيها إشعار «خرج للتسليم»", logs.some((l) => l.event === "out_for_delivery"), true);
    check("   فيها إشعار «تم التسليم»", logs.some((l) => l.event === "delivered"), true);
    check("   الحالة simulated (الواتساب مش متضبط)", logs[0]!.status, "simulated");
    check("   القالب اترندر (فيه رقم البوليصة)", logs.some((l) => l.body.includes(awb)), true);

    // ─── تقييم العميل ───
    console.log("  ── تقييم العميل (NPS) ──");
    check("٣) تقييم ٥ نجوم → 201", (await api("POST", "/api/public/v1/rate", { awb, stars: 5, comment: "ممتاز" })).status, 201);
    const [rate] = await sql<{ stars: number }[]>`SELECT stars FROM delivery_ratings dr JOIN shipments s ON s.id=dr.shipment_id WHERE s.awb=${awb}`;
    check("   اتسجّل ٥ نجوم", rate!.stars, 5);
    check("   إعادة التقييم بتحدّث (٤)", (await api("POST", "/api/public/v1/rate", { awb, stars: 4 })).status, 201);
    check("   تقييم خارج ١-٥ → مرفوض 400", (await api("POST", "/api/public/v1/rate", { awb, stars: 9 })).status, 400);

    // ─── تعديل القالب ───
    console.log("  ── تعديل القوالب ──");
    const tmpl = (await api("GET", "/api/v1/notifications")).json;
    check("٤) الـ GET بيرجّع القوالب والسجل", (tmpl.templates as unknown[]).length >= 5, true);
    const delivered = (tmpl.templates as { id: string; key: string }[]).find((t) => t.key === "delivered");
    check("   تعديل قالب «تم التسليم»", (await api("POST", "/api/v1/notifications", { id: delivered!.id, bodyAr: "وصلت شحنتك {awb} 🎉" })).status, 200);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الإشعارات نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
