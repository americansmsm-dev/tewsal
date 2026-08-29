/**
 * اختبار الأمان (مرحلة ط): صلاحيات دقيقة + وضع الطوارئ + 2FA.
 * BASE=http://127.0.0.1:3100 npx tsx scripts/verify-security.ts
 */
import postgres from "postgres";
import { totpNow } from "../src/lib/totp";

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
/** دخول خام من غير ما نلمس الكوكي الأساسي */
async function rawLogin(body: unknown) {
  const res = await fetch(BASE + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  const COURIER = crypto.randomUUID();
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    const [admin] = await sql<{ id: string }[]>`SELECT id::text FROM users WHERE username='admin'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب الأمان',${"courier_sec_" + stamp},'x','courier',false)`;

    console.log("\n═══ الأمان (مرحلة ط) ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    // ─── الصلاحيات الدقيقة ───
    console.log("  ── الصلاحيات الدقيقة ──");
    const perms = (await api("GET", `/api/v1/users/${admin!.id}/permissions`)).json;
    check("٢) كتالوج الصلاحيات موجود", (perms.catalog as unknown[]).length >= 8, true);
    // نسحب صلاحية «وضع الطوارئ» من الأدمن
    check("٣) سحب صلاحية من الأدمن", (await api("POST", `/api/v1/users/${admin!.id}/permissions`, { extra: [], revoked: ["emergency.toggle"] })).status, 200);
    check("   الأدمن مش قادر يفعّل الطوارئ (403)", (await api("POST", "/api/v1/security/emergency", { on: true })).status, 403);
    check("٤) إرجاع الصلاحية", (await api("POST", `/api/v1/users/${admin!.id}/permissions`, { extra: [], revoked: [] })).status, 200);
    check("   بقى قادر يفعّلها", (await api("POST", "/api/v1/security/emergency", { on: false })).status, 200);

    // ─── وضع الطوارئ يجمّد الدفع ───
    console.log("  ── وضع الطوارئ ──");
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-SEC-${stamp % 100000}`, nameAr: "تاجر الأمان", tier: "t1" })).json.merchant.id;
    const id = (await api("POST", "/api/v1/shipments", { merchantId, recipientName: "ع", recipientPhone: "01012345678", governorateId: gov!.id, addressLine: "المعادي", codAmount: "1000", confirm: true })).json.id;
    const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-9999-4000-8000-000000000009", courierId: COURIER });
    await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
    await tr({ to: "out_for_delivery", runSheetId: "ffffffff-9999-4000-8000-000000000009", courierId: COURIER });
    await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: "1000", method: "cash" } });
    await api("POST", "/api/v1/handovers", { courierId: COURIER, received: "1000" });
    const stl = (await api("POST", "/api/v1/settlements", { merchantId })).json.settlementId;
    await api("POST", `/api/v1/settlements/${stl}/approve`);
    check("٥) تفعيل وضع الطوارئ", (await api("POST", "/api/v1/security/emergency", { on: true })).json.frozen, true);
    check("   الدفع متجمّد → 423", (await api("POST", `/api/v1/settlements/${stl}/pay`, { method: "bank" })).status, 423);
    await api("POST", "/api/v1/security/emergency", { on: false });
    check("٦) بعد إلغاء الطوارئ → الدفع نجح", (await api("POST", `/api/v1/settlements/${stl}/pay`, { method: "bank" })).json.status, "paid");

    // ─── المصادقة الثنائية ───
    console.log("  ── المصادقة الثنائية (2FA) ──");
    const setup = (await api("POST", "/api/v1/auth/2fa", { action: "setup" })).json;
    check("٧) إعداد 2FA بيرجّع سر", (setup.secret as string)?.length > 0, true);
    const code = totpNow(setup.secret);
    check("   تفعيل بكود صح", (await api("POST", "/api/v1/auth/2fa", { action: "enable", code })).json.enabled, true);
    await wait(200);
    check("٨) دخول بدون كود → 401 NEEDS_2FA", (await rawLogin({ username: "admin", password: "Admin12345" })).json.error?.code, "NEEDS_2FA");
    check("   دخول بكود صح → 200", (await rawLogin({ username: "admin", password: "Admin12345", code: totpNow(setup.secret) })).status, 200);
    // إيقاف 2FA (بالجلسة الأصلية) عشان مايكسرش باقي الاختبارات
    check("٩) إيقاف 2FA", (await api("POST", "/api/v1/auth/2fa", { action: "disable" })).json.disabled, true);
    check("   الدخول العادي رجع يشتغل", (await rawLogin({ username: "admin", password: "Admin12345" })).status, 200);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الأمان نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    // أمان إضافي: تأكد إن 2FA اتقفل والصلاحيات رجعت
    await sql`UPDATE users SET two_factor_secret=NULL, two_factor_enabled_at=NULL, revoked_permissions='{}', extra_permissions='{}' WHERE username='admin'`;
    process.exitCode = fail === 0 ? 0 : 1;
    await sql.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await sql`UPDATE users SET two_factor_secret=NULL, two_factor_enabled_at=NULL, revoked_permissions='{}', extra_permissions='{}' WHERE username='admin'`.catch(() => {});
    await sql.end();
    process.exitCode = 1;
  }
}
main();
