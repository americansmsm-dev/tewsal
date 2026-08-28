/**
 * ============================================================
 *  اختبار الـ endpoint على HTTP حقيقي
 * ------------------------------------------------------------
 *  بيشغّل الدورة الكاملة من خلال POST /api/v1/shipments/:id/transitions
 *  عبر HTTP فعلي (مش استدعاء دالة)، وبيتأكد إن:
 *   - الدخول بيرجّع كوكي جلسة
 *   - بدون كوكي → 401
 *   - التحولات بتشتغل وبترجّع 201
 *   - التسليم بيكتب قيد مالي (نشوفه في القاعدة)
 *   - إعادة نفس الحدث → 200 (ack صامت)
 *   - أكواد الأخطاء بتترجم صح: 409 / 403 / 422
 *
 *  محتاج السيرفر شغّال على BASE (افتراضي 3100).
 *  الاستخدام: BASE=http://127.0.0.1:3100 npx tsx scripts/verify-api.ts
 * ============================================================
 */
import postgres from "postgres";
import { buildAwb } from "../src/lib/awb";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}

let cookie = "";
async function api(path: string, body?: unknown, withCookie = true) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withCookie && cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const sess = setCookie.find((c) => c.startsWith("tewsal_session="));
  if (sess) cookie = sess.split(";")[0]!;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });

  const MERCHANT = "aaaaaaaa-2222-4000-8000-000000000001";
  const COURIER = "bbbbbbbb-2222-4000-8000-000000000001";
  const SHIP = "cccccccc-2222-4000-8000-00000000000a";

  try {
    const [gov] = await sql<{ id: string; zone_id: string }[]>`
      SELECT id, zone_id FROM governorates WHERE code = 'CAI'`;
    if (!gov) throw new Error("شغّل db:seed");

    // مندوب مستخدم
    await sql`
      INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid, 'مندوب الـ API', 'api_courier', 'x', 'courier', false)
      ON CONFLICT (id) DO NOTHING`;

    // شحنة نظيفة
    await sql`ALTER TABLE shipment_status_history DISABLE TRIGGER trg_history_append_only`;
    await sql`DELETE FROM shipment_status_history WHERE shipment_id = ${SHIP}::uuid`;
    await sql`ALTER TABLE shipment_status_history ENABLE TRIGGER trg_history_append_only`;
    await sql`ALTER TABLE journal_entries DISABLE TRIGGER trg_je_immutable`;
    await sql`DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_id = ${SHIP}::uuid)`;
    await sql`DELETE FROM journal_entries WHERE source_id = ${SHIP}::uuid`;
    await sql`ALTER TABLE journal_entries ENABLE TRIGGER trg_je_immutable`;
    await sql`DELETE FROM shipments WHERE id = ${SHIP}::uuid`;

    const [seq] = await sql<{ nextval: string }[]>`SELECT nextval('awb_sequence')`;
    const awb = buildAwb(Number(seq!.nextval), 2026);
    await sql`
      INSERT INTO shipments (id, awb, merchant_id, recipient_name, recipient_phone,
                             governorate_id, zone_id, address_line, status,
                             cod_amount_p, price_p)
      VALUES (${SHIP}::uuid, ${awb}, ${MERCHANT}::uuid, 'أحمد محمود', '01012345678',
              ${gov.id}::uuid, ${gov.zone_id}::uuid, 'شارع التحرير', 'draft',
              ${"735000"}, ${"10000"})`;

    console.log(`\n═══ HTTP: شحنة ${awb} ═══\n`);

    // بدون كوكي → 401
    const noAuth = await api(`/api/v1/shipments/${SHIP}/transitions`, { to: "awaiting_pickup" }, false);
    check("١) بدون تسجيل دخول → 401", noAuth.status, 401);

    // دخول
    const login = await api("/api/v1/auth/login", { username: "admin", password: "Admin12345" });
    check("٢) الدخول نجح → 200", login.status, 200);
    check("   رجع كوكي جلسة", cookie.startsWith("tewsal_session="), true);

    // draft → awaiting_pickup
    const t1 = await api(`/api/v1/shipments/${SHIP}/transitions`, {
      to: "awaiting_pickup", expectedStatus: "draft",
    });
    check("٣) مسودة → انتظار الاستلام → 201", t1.status, 201);
    check("   النسخة بقت ٢", t1.json?.version, 2);

    // قفزة ممنوعة → 403
    const jump = await api(`/api/v1/shipments/${SHIP}/transitions`, { to: "delivered" });
    check("٤) قفزة ممنوعة → 403 NOT_ALLOWED", jump.status, 403);
    check("   كود الخطأ", jump.json?.error?.code, "NOT_ALLOWED");

    // المسار للتسليم
    await api(`/api/v1/shipments/${SHIP}/transitions`, {
      to: "pickup_assigned", pickupId: "eeeeeeee-2222-4000-8000-000000000009", courierId: COURIER,
    });
    await api(`/api/v1/shipments/${SHIP}/transitions`, { to: "picked_up" });
    const hub = await api(`/api/v1/shipments/${SHIP}/transitions`, { to: "at_hub" });
    check("٥) دخول المخزن حسب موعد متوقع", hub.json?.promisedAt !== null, true);
    await api(`/api/v1/shipments/${SHIP}/transitions`, {
      to: "out_for_delivery", runSheetId: "ffffffff-2222-4000-8000-000000000001", courierId: COURIER,
    });

    // تسليم بمبلغ من غير طريقة دفع → 400 (تحقق Zod)
    const badCod = await api(`/api/v1/shipments/${SHIP}/transitions`, {
      to: "delivered", cod: { collected: "abc", method: "cash" },
    });
    check("٦) مبلغ غير صالح → 400", badCod.status, 400);

    // التسليم الصح بالجنيه
    const deviceEvent = "77777777-2222-7000-8000-00000000000d";
    const deliver = await api(`/api/v1/shipments/${SHIP}/transitions`, {
      to: "delivered", expectedCourierId: COURIER, deviceEventId: deviceEvent, source: "pwa",
      cod: { collected: "7350", method: "cash" },
    });
    check("٧) التسليم → 201", deliver.status, 201);
    check("   اتكتب قيد مالي", deliver.json?.journalEntryNo !== null, true);

    // القيد فعلًا في القاعدة ومتوازن
    const [entry] = await sql<{ debit: string; credit: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p),0)::text AS debit, COALESCE(SUM(jl.credit_p),0)::text AS credit
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.source_id = ${SHIP}::uuid AND je.kind = 'delivery'`;
    check("٨) القيد في القاعدة متوازن", entry!.debit, entry!.credit);
    check("   إجمالي القيد ٧٦٢٣.٥٠ ج", entry!.debit, "762350");

    // إعادة نفس الحدث → 200 ack صامت
    const replay = await api(`/api/v1/shipments/${SHIP}/transitions`, {
      to: "delivered", deviceEventId: deviceEvent,
      cod: { collected: "7350", method: "cash" },
    });
    check("٩) إعادة نفس الحدث → 200 (مش 201)", replay.status, 200);
    check("   ack صامت (idempotentReplay)", replay.json?.idempotentReplay, true);

    // نفس الحدث بمبلغ مختلف → 409 AMOUNT_MISMATCH
    const mismatch = await api(`/api/v1/shipments/${SHIP}/transitions`, {
      to: "delivered", deviceEventId: deviceEvent,
      cod: { collected: "7000", method: "cash" },
    });
    check("١٠) نفس الحدث بمبلغ مختلف → 409", mismatch.status, 409);
    check("   كود الخطأ AMOUNT_MISMATCH", mismatch.json?.error?.code, "AMOUNT_MISMATCH");

    // الحالة نهائية → 403
    const afterFinal = await api(`/api/v1/shipments/${SHIP}/transitions`, { to: "at_hub" });
    check("١١) الشحنة نهائية → 403", afterFinal.status, 403);

    // القيد واحد بس
    const cnt = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM journal_entries WHERE source_id = ${SHIP}::uuid`;
    check("١٢) قيد واحد بالظبط للشحنة", cnt[0]?.n, 1);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الـ API نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await sql.end();
  } catch (err) {
    console.error("\n❌ الاختبار وقع:", err instanceof Error ? err.message : err);
    await sql.end();
    process.exitCode = 1;
  }
}

main();
