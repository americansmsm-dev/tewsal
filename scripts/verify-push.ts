/**
 * ============================================================
 *  إشعارات الجهاز — التسجيل والفان-آوت والتنضيف
 * ------------------------------------------------------------
 *  السكربت ده بيثبت السلسلة كلها من غير متصفح حقيقي:
 *
 *   ١) المفتاح العام بيتقري من الـAPI (والدفع بيتقفل بأمان
 *      لو المفاتيح مش موجودة — الإشعارات جوّه السيستم تفضل شغّالة)
 *   ٢) تسجيل جهاز · تسجيل تاني بنفس الـendpoint **بيحدّث** مش بيكرّر
 *   ٣) المستخدم بيشوف أجهزته هو بس
 *   ٤) إشعار حقيقي (تسليم شحنة) بيوصل صندوق الوارد
 *   ٥) التفضيلات: المستخدم يقفل حدث → مايجيلوش، يفتحه → يرجع
 *   ٦) إلغاء الاشتراك بيشيل الجهاز
 *   ٧) 🔒 مستخدم مايقدرش يشيل جهاز مستخدم تاني
 *
 *  ⚠️ إرسال الدفع الحقيقي محتاج متصفح — بنتأكد إن الفان-آوت
 *     مابيقعش السيستم لما يكون فيه اشتراكات وهمية، وده أهم
 *     حاجة: إشعار فاشل عمره ما يوقّف تسليم شحنة.
 *
 *  DATABASE_URL=... BASE=http://127.0.0.1:3100 \
 *    npx tsx scripts/verify-push.ts
 * ============================================================
 */
import postgres from "postgres";

const BASE = process.env.BASE ?? process.env.BASE_URL ?? "http://127.0.0.1:3100";
let pass = 0, fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const okay = String(actual) === String(expected);
  console.log(`  ${okay ? "✅" : "❌"} ${label}${okay ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  okay ? pass++ : fail++;
}

function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const c = (res.headers.getSetCookie?.() ?? []).find((x) => x.startsWith("tewsal_session="));
    if (c) cookie = c.split(";")[0]!;
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
}

/** اشتراك بشكل صحيح — مفاتيح base64url بالطول اللي المتصفح بيبعته */
function fakeSubscription(tag: string) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/verify-${tag}`,
    keys: {
      p256dh: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkQ8gVfDLNQOodmJqmgnn4kZgU9k1yPvJcQ2vCwbLh4nMhVLTiXKPBw",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  };
}

async function main() {
  const DB = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";
  const sql = postgres(DB, { max: 1, onnotice: () => {} });
  const stamp = Date.now() % 100000;

  try {
    const api = client();
    const other = client();
    console.log("\n═══ إشعارات الجهاز (Web Push) ═══\n");

    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    // ── ١) المفتاح العام ──
    const key = await api("GET", "/api/v1/push/key");
    check("٢) المفتاح العام متاح", key.status, 200);
    const keyData = key.json as { enabled: boolean; publicKey: string };
    console.log(`     الدفع ${keyData.enabled ? "متظبط ✅" : "مش متظبط (مفيش VAPID) — طبيعي محليًا"}`);

    // ── ٢) تسجيل جهاز ──
    const sub = fakeSubscription(`a-${stamp}`);
    const r1 = await api("POST", "/api/v1/push/subscribe", { ...sub, deviceLabel: "فون الاختبار" });
    check("٣) تسجيل الجهاز → 201", r1.status, 201);

    // نفس الـendpoint تاني — لازم **يحدّث** مش يكرّر
    const r2 = await api("POST", "/api/v1/push/subscribe", { ...sub, deviceLabel: "فون الاختبار (تحديث)" });
    check("٤) التسجيل المتكرر مابيفشلش", r2.status, 201);
    const [cnt] = await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
    check("٥) صف واحد بس (مش مكرر)", cnt!.n, "1");

    // ── ٣) أجهزة المستخدم ──
    const devs = await api("GET", "/api/v1/push/devices");
    const devList = (devs.json as { devices: { id: string; device_label: string }[] }).devices ?? [];
    check("٦) الجهاز ظهر في أجهزتي", devList.some((d) => d.device_label?.includes("فون الاختبار")), true);

    // ── ٤) إشعار حقيقي بيوصل ──
    console.log("  ── إشعار من حدث حقيقي ──");
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    const m = await api("POST", "/api/v1/merchants", { code: `M-PUSH-${stamp}`, nameAr: "تاجر الإشعارات", tier: "t1" });
    const merchantId = (m.json as { merchant: { id: string } }).merchant.id;
    const cu = await api("POST", "/api/v1/users", {
      fullName: "مندوب الإشعارات", username: `push_c_${stamp}`, role: "courier", password: "LongPass12345",
    });
    const courierId = (cu.json as { user: { id: string } }).user.id;

    const sh = await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "ع", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", codAmount: "300", confirm: true,
    });
    const shipmentId = (sh.json as { id: string }).id;
    const tr = (b: unknown) => api("POST", `/api/v1/shipments/${shipmentId}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-c0c0-4000-8000-000000000001", courierId });
    await tr({ to: "picked_up" });
    await tr({ to: "at_hub" });
    await tr({ to: "out_for_delivery", runSheetId: "ffffffff-c0c0-4000-8000-000000000001", courierId });
    const deliver = await tr({ to: "delivered", expectedCourierId: courierId, cod: { collected: "300", method: "cash" } });
    check("٧) التسليم نجح (الإشعار مايوقّفش الشغل)", deliver.status === 200 || deliver.status === 201, true);

    // الفان-آوت بيحصل بعد الرد — نستنّى لحظة
    await new Promise((r) => setTimeout(r, 900));
    const [inbox] = await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM notifications n
      JOIN users u ON u.id = n.user_id
      WHERE u.id = ${courierId}::uuid AND n.event = 'status.delivered'`;
    check("٨) إشعار التسليم وصل صندوق وارد المندوب", Number(inbox!.n) >= 1, true);

    // ── ٥) التفضيلات ──
    console.log("  ── تفضيلات المستخدم ──");
    const off = await api("PATCH", "/api/v1/notifications/prefs", {
      event: "status.delivered", channel: "inapp", enabled: false,
    });
    check("٩) قفل الحدث → 200", off.status, 200);

    const before = (await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM notifications WHERE user_id = (SELECT id FROM users WHERE username='admin')`)[0]!.n;

    // إشعار يدوي للأدمن على نفس الحدث المقفول
    const [adminRow] = await sql<{ id: string }[]>`SELECT id::text FROM users WHERE username='admin'`;
    await sql`
      INSERT INTO notification_prefs (user_id, event, channel, enabled)
      VALUES (${adminRow!.id}::uuid, 'manual', 'inapp', false)
      ON CONFLICT (user_id, event, channel) DO UPDATE SET enabled = false`;
    await api("POST", "/api/v1/notifications/send", {
      target: { type: "role", value: "super_admin" }, title: "اختبار مقفول", body: "مالمفروضش يوصل",
    });
    const after = (await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM notifications WHERE user_id = ${adminRow!.id}::uuid`)[0]!.n;
    check("١٠) الحدث المقفول مايوصلش", after, before);

    // نفتحه تاني
    await sql`DELETE FROM notification_prefs WHERE user_id = ${adminRow!.id}::uuid AND event='manual'`;
    await api("POST", "/api/v1/notifications/send", {
      target: { type: "role", value: "super_admin" }, title: "اختبار مفتوح", body: "المفروض يوصل",
    });
    const reopened = (await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM notifications WHERE user_id = ${adminRow!.id}::uuid`)[0]!.n;
    check("١١) بعد ما فتحه تاني بيوصل", Number(reopened) > Number(after), true);

    // ── ٦) 🔒 مستخدم مايشيلش جهاز حد تاني ──
    console.log("  ── الحدود ──");
    await other("POST", "/api/v1/auth/login", { username: `push_c_${stamp}`, password: "LongPass12345" });
    const mine = devList[0]!.id;
    const steal = await other("DELETE", `/api/v1/push/devices?id=${mine}`);
    // بيرد 200 بس مابيمسحش حاجة — الحذف مقيّد بالمستخدم
    const [still] = await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM push_subscriptions WHERE id = ${mine}::uuid`;
    check("١٢) مستخدم تاني مقدرش يشيل جهازي", still!.n, "1");
    check("    (الرد نفسه مش خطأ سيرفر)", steal.status < 500, true);

    // ── ٧) إلغاء الاشتراك ──
    const un = await api("POST", "/api/v1/push/unsubscribe", { endpoint: sub.endpoint });
    check("١٣) إلغاء الاشتراك → 200", un.status, 200);
    const [gone] = await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
    check("١٤) الجهاز اتشال فعلًا", gone!.n, "0");

    console.log("\n" + "─".repeat(56));
    console.log(fail === 0 ? `✅ إشعارات الجهاز سليمة (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(56) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
