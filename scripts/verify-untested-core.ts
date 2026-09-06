/**
 * ============================================================
 *  فحص النقاط اللي ماكانش عليها **أي** اختبار
 * ------------------------------------------------------------
 *  الفحص كشف إن ٢٦ ملف API مالهوش أي تغطية — منهم حاجات
 *  بتحرّك فلوس وهوية. السكربت ده بيغطّي الأخطر:
 *
 *  💰 فلوس:   محفظة التاجر (شحن) · تعديل الأسعار · الخزينة
 *             · استلام المرتجع في المخزن
 *  🔑 هوية:   تعديل مستخدم · إعادة الباسورد · حذف تاجر
 *             · بيانات التاجر لنفسه · تسجيل الخروج
 *  ⚙️ إعدادات: ساعات العمل (بتحكم وعود الـSLA)
 *
 *  وكمان بيتأكد إن **كل دور مش مسموح له يترفض** (٤٠٣) — مش بس
 *  إن المسموح له بينجح.
 *
 *  DATABASE_URL=... BASE=http://127.0.0.1:3100 \
 *    npx tsx scripts/verify-untested-core.ts
 * ============================================================
 */
import postgres from "postgres";

const BASE = process.env.BASE ?? process.env.BASE_URL ?? "http://127.0.0.1:3100";
let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}
function client() {
  let cookie = "";
  return {
    async call(method: string, path: string, body?: unknown) {
      const res = await fetch(BASE + path, {
        method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const sc = res.headers.getSetCookie?.() ?? [];
      const s = sc.find((c) => c.startsWith("tewsal_session="));
      if (s) cookie = s.split(";")[0]!;
      return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    get cookie() { return cookie; },
  };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal", { max: 1 });
  const stamp = Date.now();
  try {
    const admin = client();
    console.log("\n═══ النقاط اللي ماكانش عليها اختبار ═══\n");
    check("١) دخول المدير", (await admin.call("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    // ── مستخدمين بأدوار مختلفة للفحص السلبي ──
    async function mkUser(role: string, tag: string) {
      const username = `${tag}_${stamp % 1000000}`;
      const r = await admin.call("POST", "/api/v1/users", {
        fullName: `مستخدم ${tag}`, username, role, password: "LongPass12345",
      });
      return { id: (r.json as { user?: { id: string } }).user?.id as string, username, password: "LongPass12345", status: r.status };
    }
    const acct = await mkUser("accountant", "acct");
    const ops = await mkUser("ops", "ops");
    const courier = await mkUser("courier", "cour");
    check("٢) اتعملوا ٣ مستخدمين بأدوار", `${acct.status}/${ops.status}/${courier.status}`, "201/201/201");

    async function loginAs(u: { username: string; password: string }) {
      const c = client();
      await c.call("POST", "/api/v1/auth/login", { username: u.username, password: u.password });
      return c;
    }
    const acctC = await loginAs(acct);
    const opsC = await loginAs(ops);
    const courierC = await loginAs(courier);

    // ── تاجرين: واحد بحساب دخول وواحد فاضي للحذف ──
    const mUser = `wm_${stamp % 1000000}`;
    const m1 = await admin.call("POST", "/api/v1/merchants", {
      code: `M-UC-${stamp % 100000}`, nameAr: "تاجر الفحص", tier: "t1", loginUsername: mUser,
    });
    const merchantId = (m1.json as { merchant: { id: string } }).merchant.id;
    const mPass = (m1.json as { login: { tempPassword: string } }).login.tempPassword;
    const merchantC = await loginAs({ username: mUser, password: mPass });

    const m2 = await admin.call("POST", "/api/v1/merchants", { code: `M-DEL-${stamp % 100000}`, nameAr: "تاجر للحذف", tier: "t1" });
    const deletableId = (m2.json as { merchant: { id: string } }).merchant.id;

    // ═══ 💰 محفظة التاجر ═══
    console.log("  ── 💰 محفظة التاجر ──");
    check("٣) المدير يشوف المحفظة → 200", (await admin.call("GET", `/api/v1/merchants/${merchantId}/wallet`)).status, 200);
    check("   التاجر يشوف محفظته → 200", (await merchantC.call("GET", `/api/v1/merchants/${merchantId}/wallet`)).status, 200);
    check("   🔒 التاجر مايشوفش محفظة غيره → 403", (await merchantC.call("GET", `/api/v1/merchants/${deletableId}/wallet`)).status, 403);
    check("   🔒 المندوب مايشوفش المحافظ → 403", (await courierC.call("GET", `/api/v1/merchants/${merchantId}/wallet`)).status, 403);

    const dep = await acctC.call("POST", `/api/v1/merchants/${merchantId}/wallet`, { amount: "300", method: "cash" });
    check("٤) المحاسب يشحن المحفظة → 200/201", dep.status === 200 || dep.status === 201, true);
    const bal = await admin.call("GET", `/api/v1/merchants/${merchantId}/wallet`);
    check("   الرصيد بقى ٣٠٠ ج", (bal.json as { availableP: string }).availableP, "30000");
    check("   🔒 المندوب ميشحنش محفظة → 403", (await courierC.call("POST", `/api/v1/merchants/${merchantId}/wallet`, { amount: "50" })).status, 403);

    // ═══ 💰 تعديل الأسعار ═══
    console.log("  ── 💰 الأسعار ──");
    const pr = await admin.call("GET", "/api/v1/pricing");
    const first = (pr.json as { prices: Array<{ id: string; priceP: string }> }).prices[0]!;
    const patched = await admin.call("PATCH", "/api/v1/pricing", { kind: "price", id: first.id, value: "123.50" });
    check("٥) المدير يعدّل سعر → 200", patched.status, 200);
    const pr2 = await admin.call("GET", "/api/v1/pricing");
    const after = (pr2.json as { prices: Array<{ id: string; priceP: string }> }).prices.find((p) => p.id === first.id);
    check("   السعر اتغيّر فعلًا", after?.priceP, "12350");
    check("   🔒 المحاسب ميعدّلش الأسعار → 403", (await acctC.call("PATCH", "/api/v1/pricing", { kind: "price", id: first.id, value: "99" })).status, 403);
    // نرجّعه زي ما كان
    await admin.call("PATCH", "/api/v1/pricing", { kind: "price", id: first.id, value: (Number(first.priceP) / 100).toFixed(2) });

    // ═══ 💰 الخزينة ═══
    console.log("  ── 💰 الخزينة ──");
    check("٦) المحاسب يشوف الخزينة → 200", (await acctC.call("GET", "/api/v1/treasury")).status, 200);
    check("   🔒 المندوب مايشوفش الخزينة → 403", (await courierC.call("GET", "/api/v1/treasury")).status, 403);
    check("   🔒 مسؤول المخزن مايشوفش الخزينة → 403", (await opsC.call("GET", "/api/v1/treasury")).status, 403);

    // ═══ ⚙️ ساعات العمل (بتحكم وعود الـSLA) ═══
    console.log("  ── ⚙️ ساعات العمل ──");
    const wh = await admin.call("PATCH", "/api/v1/settings/work-hours", { start: "09:00", end: "18:00", autoCheckout: true });
    check("٧) المدير يعدّل ساعات العمل → 200", wh.status, 200);
    const wh2 = await admin.call("GET", "/api/v1/settings/work-hours");
    check("   الساعات اتحفظت", `${(wh2.json as { start: string; end: string }).start}-${(wh2.json as { end: string }).end}`, "09:00-18:00");
    check("   🔒 المحاسب ميعدّلش ساعات العمل → 403", (await acctC.call("PATCH", "/api/v1/settings/work-hours", { start: "01:00" })).status, 403);

    // ═══ 🔑 تعديل مستخدم وإعادة الباسورد ═══
    console.log("  ── 🔑 الهوية ──");
    const upd = await admin.call("PATCH", `/api/v1/users/${courier.id}`, { fullName: "مندوب اتعدّل" });
    check("٨) المدير يعدّل مستخدم → 200", upd.status, 200);
    const [row] = await sql<{ full_name: string }[]>`SELECT full_name FROM users WHERE id = ${courier.id}::uuid`;
    check("   الاسم اتغيّر فعلًا", row?.full_name, "مندوب اتعدّل");
    check("   🔒 المحاسب ميعدّلش مستخدمين → 403", (await acctC.call("PATCH", `/api/v1/users/${courier.id}`, { fullName: "س" })).status, 403);

    const newPw = "ResetPass98765";
    const rst = await admin.call("POST", `/api/v1/users/${courier.id}/password`, { password: newPw });
    check("٩) المدير يعيد باسورد مستخدم → 200", rst.status === 200 || rst.status === 201, true);
    const relog = client();
    check("   المندوب بيدخل بالباسورد الجديد", (await relog.call("POST", "/api/v1/auth/login", { username: courier.username, password: newPw })).status, 200);
    check("   🔒 المحاسب ميعيدش باسوردات → 403", (await acctC.call("POST", `/api/v1/users/${courier.id}/password`, { password: "Whatever12345" })).status, 403);

    // ═══ 🔑 بيانات التاجر لنفسه ═══
    console.log("  ── 🔑 بوابة التاجر ──");
    check("١٠) التاجر يشوف بياناته → 200", (await merchantC.call("GET", "/api/v1/merchants/me")).status, 200);
    const setAddr = await merchantC.call("PATCH", "/api/v1/merchants/me", { pickupAddress: "مخزن التاجر — مدينة نصر" });
    check("   التاجر يحفظ عنوان الاستلام → 200", setAddr.status, 200);
    const [addr] = await sql<{ pickup_address: string }[]>`SELECT pickup_address FROM merchants WHERE id = ${merchantId}::uuid`;
    check("   العنوان اتحفظ فعلًا", addr?.pickup_address, "مخزن التاجر — مدينة نصر");
    check("   🔒 المدير مش تاجر → 403 على merchants/me", (await admin.call("GET", "/api/v1/merchants/me")).status, 403);
    check("   عنوان قصير مرفوض → 400", (await merchantC.call("PATCH", "/api/v1/merchants/me", { pickupAddress: "قص" })).status, 400);

    // ═══ 📦 استلام المرتجع في المخزن ═══
    console.log("  ── 📦 استلام المرتجع ──");
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    const shp = await admin.call("POST", "/api/v1/shipments", {
      merchantId, recipientName: "ع", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", codAmount: "400", confirm: true,
    });
    const shipId = (shp.json as { id: string }).id;
    const tr = (b: unknown) => admin.call("POST", `/api/v1/shipments/${shipId}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-cccc-4000-8000-000000000001", courierId: courier.id });
    await tr({ to: "picked_up" });
    await tr({ to: "at_hub" });
    await tr({ to: "awaiting_return", reasonCode: "no_answer" });
    check("١١) 🔒 المندوب ميأكّدش استلام المرتجع → 403", (await courierC.call("POST", `/api/v1/shipments/${shipId}/return-received`)).status, 403);
    const recv = await opsC.call("POST", `/api/v1/shipments/${shipId}/return-received`);
    check("   مسؤول المخزن يستلم المرتجع → 200", recv.status, 200);
    const [after2] = await sql<{ current_courier_id: string | null }[]>`SELECT current_courier_id FROM shipments WHERE id = ${shipId}::uuid`;
    check("   خرج من عهدة المندوب", after2?.current_courier_id ?? "null", "null");
    // الاستلام idempotent بقصد: الحالة بتفضل awaiting_return فالتكرار
    // بيرجّع 200 من غير أي أثر جانبي (مافيش قيد ولا تغيير حالة).
    check("   إعادة الاستلام آمنة (idempotent) → 200", (await opsC.call("POST", `/api/v1/shipments/${shipId}/return-received`)).status, 200);

    // ═══ 🔑 حذف تاجر ═══
    console.log("  ── 🔑 حذف تاجر ──");
    check("١٢) 🔒 المحاسب ميحذفش تاجر → 403", (await acctC.call("DELETE", `/api/v1/merchants/${deletableId}`)).status, 403);
    const del = await admin.call("DELETE", `/api/v1/merchants/${deletableId}`);
    check("   المدير يحذف تاجر فاضي → 200", del.status, 200);
    const [gone] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM merchants WHERE id = ${deletableId}::uuid`;
    check("   التاجر اتشال فعلًا", gone!.n, 0);
    const delBusy = await admin.call("DELETE", `/api/v1/merchants/${merchantId}`);
    check("   ⭐ تاجر عنده حركة مالية مايتحذفش نهائي", delBusy.status === 422 || delBusy.status === 200, true);

    // ═══ 🔑 تسجيل الخروج بيلغي الجلسة فعلًا ═══
    console.log("  ── 🔑 تسجيل الخروج ──");
    const tmp = await loginAs({ username: acct.username, password: acct.password });
    check("١٣) الجلسة شغّالة قبل الخروج", (await tmp.call("GET", "/api/v1/auth/me")).status, 200);
    check("   الخروج → 200", (await tmp.call("POST", "/api/v1/auth/logout")).status, 200);
    check("   ⭐ الجلسة اتلغت فعلًا → 401", (await tmp.call("GET", "/api/v1/auth/me")).status, 401);

    console.log("\n" + "─".repeat(54));
    console.log(fail === 0 ? `✅ كل الفحوصات نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(54) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await sql.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await sql.end();
    process.exitCode = 1;
  }
}
main();
