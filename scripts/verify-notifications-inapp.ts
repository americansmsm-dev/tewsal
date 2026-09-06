/**
 * ============================================================
 *  اختبار الإشعارات الداخلية (in-app)
 * ------------------------------------------------------------
 *  ١) تغيير حالة الشحنة بيبعت إشعار للتاجر والمندوب المسند.
 *  ٢) feed بيرجّع الإشعارات + عدد غير المقروء، و read بيصفّره.
 *  ٣) تسجيل عمولة بيبعت إشعار للمندوب.
 *  ٤) المُرسِل اليدوي بيبعت لدور كامل (كل المناديب).
 *
 *  الإطلاق best-effort بعد الكوميت — بننتظر لحظة قبل الفحص.
 *
 *  DATABASE_URL=postgres://postgres@127.0.0.1:54320/tewsal \
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-notifications-inapp.ts
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.getSetCookie?.() ?? [];
    const s = sc.find((c) => c.startsWith("tewsal_session="));
    if (s) cookie = s.split(";")[0]!;
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal", { max: 1 });
  const COURIER = crypto.randomUUID();
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,${"مندوب الإشعارات " + (stamp % 1000)},${"courier_nt_" + stamp},'x','courier',false)`;

    console.log("\n═══ الإشعارات الداخلية ═══\n");
    const admin = client();
    check("١) دخول المدير", (await admin("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    const uname = `nt_merch_${stamp % 100000}`;
    const mR = await admin("POST", "/api/v1/merchants", {
      code: `M-NT-${stamp % 100000}`, nameAr: "تاجر الإشعارات", tier: "t1", loginUsername: uname,
    });
    const merchantId = mR.json.merchant.id as string;
    const tempPw = mR.json.login.tempPassword as string;
    const [mu] = await sql<{ id: string }[]>`SELECT id FROM users WHERE merchant_id=${merchantId}::uuid AND role='merchant' LIMIT 1`;
    const merchantUserId = mu!.id;

    // تسليم شحنة → سلسلة إشعارات حالة
    const shipId = (await admin("POST", "/api/v1/shipments", {
      merchantId, recipientName: "ع", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", codAmount: "500", confirm: true,
    })).json.id as string;
    const tr = (b: unknown) => admin("POST", `/api/v1/shipments/${shipId}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-8888-4000-8000-000000000009", courierId: COURIER });
    await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
    await tr({ to: "out_for_delivery", runSheetId: "ffffffff-8888-4000-8000-000000000009", courierId: COURIER });
    await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: "500", method: "cash" } });
    await sleep(600); // الإطلاق best-effort بعد الكوميت

    // ─── إشعارات الحالة في الداتا ───
    console.log("  ── إشعارات الحالة ──");
    const mNotifs = await sql<{ event: string }[]>`SELECT event FROM notifications WHERE user_id=${merchantUserId}::uuid AND entity_id=${shipId}`;
    check("٢) التاجر وصله إشعار تسليم", mNotifs.some((n) => n.event === "status.delivered"), true);
    const cNotifs = await sql<{ event: string }[]>`SELECT event FROM notifications WHERE user_id=${COURIER}::uuid AND entity_id=${shipId}`;
    check("٣) المندوب وصله إشعار تسليم", cNotifs.some((n) => n.event === "status.delivered"), true);
    check("   المندوب وصله إشعار خروج للتسليم", cNotifs.some((n) => n.event === "status.out_for_delivery"), true);

    // ─── feed + read (بجلسة التاجر) ───
    console.log("  ── feed + read ──");
    const merchant = client();
    await merchant("POST", "/api/v1/auth/login", { username: uname, password: tempPw });
    const feed1 = await merchant("GET", "/api/v1/notifications/feed");
    check("٤) feed بيرجّع إشعارات التاجر", Number(feed1.json.unreadCount) > 0, true);
    check("   فيه إشعار عنوانه تسليم", (feed1.json.notifications as Array<{ event: string }>).some((n) => n.event === "status.delivered"), true);
    await merchant("POST", "/api/v1/notifications/read", { all: true });
    const feed2 = await merchant("GET", "/api/v1/notifications/feed");
    check("٥) بعد التعليم مقروء العدّاد ٠", feed2.json.unreadCount, 0);

    // ─── إشعار العمولة ───
    console.log("  ── العمولة ──");
    const cm = await admin("POST", "/api/v1/courier-commissions", { courierId: COURIER, shipmentIds: [shipId], amountPerOrder: "50" });
    check("٦) تسجيل العمولة → 201", cm.status, 201);
    await sleep(500);
    const commNotif = await sql<{ n: number }[]>`SELECT count(*)::int n FROM notifications WHERE user_id=${COURIER}::uuid AND event='commission'`;
    check("   المندوب وصله إشعار عمولة", commNotif[0]!.n > 0, true);

    // ─── المُرسِل اليدوي (لدور المناديب) ───
    console.log("  ── المُرسِل اليدوي ──");
    const send = await admin("POST", "/api/v1/notifications/send", {
      target: { type: "courier", value: COURIER }, title: "رسالة من الإدارة", body: "برجاء تسليم العهدة النهاردة",
    });
    check("٧) الإرسال اليدوي → 201", send.status, 201);
    check("   وصلت لمستخدم واحد", send.json.sent, 1);
    await sleep(300);
    const manNotif = await sql<{ title_ar: string }[]>`SELECT title_ar FROM notifications WHERE user_id=${COURIER}::uuid AND event='manual' ORDER BY created_at DESC LIMIT 1`;
    check("   الإشعار اليدوي اتخزّن بعنوانه", manNotif[0]?.title_ar, "رسالة من الإدارة");

    // إرسال لدور كامل
    const sendRole = await admin("POST", "/api/v1/notifications/send", {
      target: { type: "role", value: "courier" }, title: "تعميم للمناديب", body: "اجتماع الساعة ٥",
    });
    check("٨) إرسال لدور «المناديب» → 201", sendRole.status, 201);
    check("   وصلت لأكتر من صفر", Number(sendRole.json.sent) > 0, true);

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
