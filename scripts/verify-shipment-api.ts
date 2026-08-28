/**
 * ============================================================
 *  اختبار دورة الشحنة الكاملة على HTTP
 * ------------------------------------------------------------
 *  فتح تاجر → إنشاء شحنة (السعر بيتثبّت) → قائمة → تتبع عام
 *  → تأكيد → المسار للتسليم → التحصيل → القيد المالي.
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-shipment-api.ts
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
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code = 'CAI'`;
    const [alx] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code = 'ALX'`;
    const [qly] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code = 'QLY'`; // cod_enabled=false

    console.log("\n═══ دورة الشحنة الكاملة على HTTP ═══\n");

    // دخول
    const login = await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" });
    check("١) دخول المدير", login.status, 200);

    // فتح تاجر بشريحة t2
    const code = `M-${Date.now() % 100000}`;
    const mer = await api("POST", "/api/v1/merchants", {
      code, nameAr: "متجر الاختبار", phone: "01011122233", tier: "t2",
    });
    check("٢) فتح تاجر → 201", mer.status, 201);
    const merchantId = (mer.json?.merchant as { id: string })?.id;
    check("   رجع معرّف التاجر", typeof merchantId === "string", true);

    // كود تاجر مكرر → 409
    const dup = await api("POST", "/api/v1/merchants", { code, nameAr: "تكرار" });
    check("٣) كود تاجر مكرر → 409", dup.status, 409);

    // إنشاء شحنة للقاهرة، تاجر t2 → سعر ٨٠ ج
    const ship = await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "أحمد محمود", recipientPhone: "0100 123 4567",
      governorateId: gov!.id, addressLine: "شارع التحرير، وسط البلد",
      codAmount: "7350", paymentMethod: "cash",
    });
    check("٤) إنشاء شحنة → 201", ship.status, 201);
    check("   السعر اتثبّت ٨٠ ج (شريحة t2 قاهرة)", ship.json?.price, "80.00 ج");
    check("   رجع AWB", typeof ship.json?.awb === "string", true);
    const awb = ship.json?.awb as string;
    const shipmentId = ship.json?.id as string;
    // الرسوم: شحن ٨٠ + تحصيل (١٠٠ + ١٪×٧٣٥٠=٧٣.٥٠) = ٢٥٣.٥٠
    check("   إجمالي الرسوم ٢٥٣.٥٠ ج", ship.json?.totalFees, "253.50 ج");

    // شحنة بتحصيل لمحافظة التحصيل فيها مقفول → 422
    const noCod = await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "س", recipientPhone: "01012345678",
      governorateId: qly!.id, addressLine: "بنها", codAmount: "500",
    });
    check("٥) تحصيل في محافظة مقفولة → 422", noCod.status, 422);
    check("   كود COD_UNAVAILABLE", noCod.json?.error?.code, "COD_UNAVAILABLE");

    // إسكندرية t2 → سعر الدلتا ١٠٠ ج
    const alxShip = await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "منى", recipientPhone: "01087654321",
      governorateId: alx!.id, addressLine: "سيدي جابر", codAmount: "2000",
    });
    check("٦) الإسكندرية → سعر الدلتا ١٠٠ ج", alxShip.json?.price, "100.00 ج");

    // رقم أوردر مكرر لنفس التاجر → 409
    const ref = "ORD-777";
    await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "ع", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", merchantReference: ref,
    });
    const dupRef = await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "ع", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", merchantReference: ref,
    });
    check("٧) رقم أوردر مكرر → 409", dupRef.status, 409);
    check("   كود DUPLICATE_REFERENCE", dupRef.json?.error?.code, "DUPLICATE_REFERENCE");

    // القائمة
    const list = await api("GET", `/api/v1/shipments?merchantId=${merchantId}`);
    check("٨) قائمة الشحنات ترجع", list.status, 200);
    check("   فيها ٣ شحنات على الأقل", (list.json?.count as number) >= 3, true);

    // التتبع العام — بدون تسجيل دخول، ومقنّع
    const track = await api("GET", `/api/v1/track/${awb}`, undefined, false);
    check("٩) التتبع العام شغّال بدون دخول", track.status, 200);
    check("   مفيش مبلغ تحصيل في التتبع", JSON.stringify(track.json).includes("7350"), false);
    check("   مفيش اسم تاجر في التتبع", JSON.stringify(track.json).includes("متجر الاختبار"), false);

    // AWB غلط → 400
    const badTrack = await api("GET", `/api/v1/track/T99999999999`, undefined, false);
    check("١٠) AWB بـ check digit غلط → 400", badTrack.status, 400);

    // تأكيد الشحنة ثم المسار للتسليم
    const courierId = "bbbbbbbb-3333-4000-8000-000000000001";
    await sql`
      INSERT INTO users (id, full_name, username, password_hash, role, phone, must_change_password)
      VALUES (${courierId}::uuid, 'كريم المندوب', 'courier_ship', 'x', 'courier', '01055566677', false)
      ON CONFLICT (id) DO NOTHING`;

    async function tr(body: unknown) {
      return api("POST", `/api/v1/shipments/${shipmentId}/transitions`, body);
    }
    check("١١) تأكيد الشحنة", (await tr({ to: "awaiting_pickup", expectedStatus: "draft" })).status, 201);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-3333-4000-8000-000000000009", courierId });
    await tr({ to: "picked_up" });
    await tr({ to: "at_hub" });

    // التتبع دلوقتي بيوريّ حالة "في مركز توصّل"
    const track2 = await api("GET", `/api/v1/track/${awb}`, undefined, false);
    check("١٢) التتبع بيوري خط زمني", (track2.json?.timeline as unknown[])?.length >= 1, true);

    await tr({ to: "out_for_delivery", runSheetId: "ffffffff-3333-4000-8000-000000000001", courierId });

    // التتبع دلوقتي بيوري اسم المندوب مقنّع
    const track3 = await api("GET", `/api/v1/track/${awb}`, undefined, false);
    const cName = (track3.json?.courier as { name?: string })?.name ?? "";
    check("١٣) اسم المندوب بيظهر مقنّع بعد الخروج", cName.includes("*"), true);

    const deliver = await tr({
      to: "delivered", expectedCourierId: courierId,
      cod: { collected: "7350", method: "cash" },
    });
    check("١٤) التسليم → 201", deliver.status, 201);
    check("   اتكتب قيد مالي", deliver.json?.journalEntryNo !== null, true);

    // القيد في القاعدة = ٧٦٢٣.٥٠ (٧٣٥٠ + شحن ٨٠ + تحصيل ١٩٣.٥٠)؟
    // تحصيل: ١٠٠ + ١٪×٧٣٥٠ = ١٧٣.٥٠ → إجمالي مدين = ٧٣٥٠ + ٨٠ + ١٧٣.٥٠ = ٧٦٠٣.٥٠
    const [entry] = await sql<{ debit: string; credit: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p),0)::text AS debit, COALESCE(SUM(jl.credit_p),0)::text AS credit
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.source_id = ${shipmentId}::uuid AND je.kind = 'delivery'`;
    check("١٥) القيد متوازن", entry!.debit, entry!.credit);
    check("   إجمالي القيد ٧٦٠٣.٥٠ ج (شحن ٨٠ + تحصيل ١٧٣.٥٠)", entry!.debit, "760350");

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات دورة الشحنة نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
