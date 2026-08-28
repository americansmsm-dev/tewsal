/**
 * ============================================================
 *  اختبار applyTransition على قاعدة بيانات حقيقية
 * ------------------------------------------------------------
 *  بيمشّي شحنة في دورة حياتها الكاملة من خلال البوابة الوحيدة،
 *  وبيتأكد إن:
 *   - الحالات بتتنقل صح والممنوع بيترفض
 *   - القيد المالي بيتكتب في نفس ترانزاكشن التسليم
 *   - الموعد المتوقع بيتحسب مرة واحدة عند دخول المخزن
 *   - إعادة مزامنة الـ PWA بترجع ack صامت (مش قيد مكرر)
 *   - نفس الحدث بمبلغ مختلف بيترفض
 *   - القفل التفاؤلي بيمسك التعارض
 *
 *  الاستخدام: npx tsx scripts/verify-transition.ts
 * ============================================================
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { poundsToPiastres as P, formatEGP } from "../src/lib/money";
import { buildAwb } from "../src/lib/awb";
import { buildDeliveryEntry, ACC } from "../src/server/domain/ledger";
import { accountBalance, recomputeMerchantBalance } from "../src/server/services/ledger";
import { applyTransition, TransitionError } from "../src/server/services/transition";
import type { Actor } from "../src/server/services/transition";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `\n       المتوقع: ${expected}\n       الفعلي:  ${actual}`}`);
  ok ? pass++ : fail++;
}
async function expectReject(label: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, "اتقبل!", `اترفض (${code})`);
  } catch (err) {
    const c = err instanceof TransitionError ? err.code : "خطأ تاني";
    check(label, c, code);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL مش متعرّف");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  const MERCHANT = "aaaaaaaa-1111-4000-8000-000000000001";
  const COURIER = "bbbbbbbb-1111-4000-8000-000000000001";
  const OTHER_COURIER = "bbbbbbbb-1111-4000-8000-000000000002";
  const SHIP = "cccccccc-1111-4000-8000-00000000000a";
  const RUNSHEET = "ffffffff-1111-4000-8000-000000000001";

  const ops: Actor = { userId: null, role: "ops", name: "موظف العمليات" };
  const courier: Actor = { userId: null, role: "courier", name: "محمد المندوب" };

  try {
    const [gov] = await sql<{ id: string; zone_id: string }[]>`
      SELECT id, zone_id FROM governorates WHERE code = 'CAI'`;
    if (!gov) throw new Error("شغّل db:seed الأول");

    // المناديب مستخدمين — FK على users
    const courierUsers: Array<[string, string, string]> = [
      [COURIER, "محمد المندوب", "courier_test_1"],
      [OTHER_COURIER, "مندوب تاني", "courier_test_2"],
    ];
    for (const [id, name, uname] of courierUsers) {
      await sql`
        INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
        VALUES (${id}::uuid, ${name}, ${uname}, 'x', 'courier', false)
        ON CONFLICT (id) DO NOTHING
      `;
    }

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
                             cod_amount_p, price_p, total_fees_p)
      VALUES (${SHIP}::uuid, ${awb}, ${MERCHANT}::uuid, 'أحمد محمود', '01012345678',
              ${gov.id}::uuid, ${gov.zone_id}::uuid, 'شارع التحرير', 'draft',
              ${P("7350").toString()}, ${P("100").toString()}, ${P("273.50").toString()})
    `;

    console.log(`\n═══ شحنة ${awb} — دورة حياة كاملة ═══\n`);

    // draft → awaiting_pickup
    await db.transaction(async (tx) => {
      const r = await applyTransition(tx, {
        shipmentId: SHIP, to: "awaiting_pickup", actor: ops, expectedStatus: "draft",
      });
      check("١) مسودة → في انتظار الاستلام", r.toStatus, "awaiting_pickup");
      check("   النسخة بقت ٢", r.version, 2);
    });

    // منع القفزة: awaiting_pickup → delivered
    await expectReject("٢) قفزة ممنوعة (انتظار → تسليم) بترفض", "NOT_ALLOWED", () =>
      db.transaction((tx) =>
        applyTransition(tx, { shipmentId: SHIP, to: "delivered", actor: courier })
      )
    );

    // awaiting_pickup → pickup_assigned (محتاج pickup)
    await expectReject("٣) إسناد استلام بدون طلب استلام بيرفض", "NOT_ALLOWED", () =>
      db.transaction((tx) =>
        applyTransition(tx, { shipmentId: SHIP, to: "pickup_assigned", actor: ops })
      )
    );
    await db.transaction(async (tx) => {
      const r = await applyTransition(tx, {
        shipmentId: SHIP, to: "pickup_assigned", actor: ops,
        pickupId: "eeeeeeee-1111-4000-8000-000000000009", courierId: COURIER,
      });
      check("٤) إسناد الاستلام لمندوب", r.toStatus, "pickup_assigned");
    });

    // pickup_assigned → picked_up
    await db.transaction((tx) =>
      applyTransition(tx, { shipmentId: SHIP, to: "picked_up", actor: courier, expectedCourierId: COURIER })
    );

    // picked_up → at_hub (بيحسب الموعد المتوقع)
    let promised: Date | null = null;
    await db.transaction(async (tx) => {
      const r = await applyTransition(tx, { shipmentId: SHIP, to: "at_hub", actor: ops });
      promised = r.promisedAt;
      check("٥) دخول المخزن حسب موعد متوقع", promised !== null, true);
    });

    // at_hub → out_for_delivery (محتاج run_sheet)
    await db.transaction((tx) =>
      applyTransition(tx, {
        shipmentId: SHIP, to: "out_for_delivery", actor: ops,
        runSheetId: RUNSHEET, courierId: COURIER,
      })
    );

    // ⚠️ REASSIGNED — مندوب تاني يحاول يسلّم
    await expectReject("٦) مندوب تاني يحاول التسليم → REASSIGNED", "REASSIGNED", () =>
      db.transaction((tx) =>
        applyTransition(tx, {
          shipmentId: SHIP, to: "delivered", actor: courier,
          expectedCourierId: OTHER_COURIER,
          cod: { collectedP: P("7350"), method: "cash" },
          buildFinancialEntry: async () => buildDeliveryEntry({
            shipmentId: SHIP, merchantId: MERCHANT, courierId: OTHER_COURIER, awb,
            codCollectedP: P("7350"), paymentMethod: "cash",
            shippingP: P("100"), codFeeP: P("173.50"), otherFeesP: 0n,
          }),
        })
      )
    );

    // ⚠️ تسليم مالي من غير قيد → FINANCIAL_REQUIRED
    await expectReject("٧) تسليم من غير قيد مالي بيرفض", "FINANCIAL_REQUIRED", () =>
      db.transaction((tx) =>
        applyTransition(tx, {
          shipmentId: SHIP, to: "delivered", actor: courier,
          cod: { collectedP: P("7350"), method: "cash" },
        })
      )
    );

    // ✅ التسليم الصح — الحالة + القيد في نفس الترانزاكشن
    const deviceEvent = "99999999-1111-7000-8000-00000000000d";
    await db.transaction(async (tx) => {
      const r = await applyTransition(tx, {
        shipmentId: SHIP, to: "delivered", actor: courier,
        expectedCourierId: COURIER, deviceEventId: deviceEvent, source: "pwa",
        cod: { collectedP: P("7350"), method: "cash" },
        buildFinancialEntry: async () => buildDeliveryEntry({
          shipmentId: SHIP, merchantId: MERCHANT, courierId: COURIER, awb,
          codCollectedP: P("7350"), paymentMethod: "cash",
          shippingP: P("100"), codFeeP: P("173.50"), otherFeesP: 0n,
        }),
      });
      check("٨) تم التسليم", r.toStatus, "delivered");
      check("   اتكتب قيد مالي مع التسليم", r.journalEntryNo !== null, true);
      check("   كاش المندوب زاد ٧٣٥٠",
        formatEGP(await accountBalance(tx, ACC.courierCash(COURIER))), "7,350.00 ج");
      const bal = await recomputeMerchantBalance(tx, MERCHANT);
      check("   مستحقات التاجر ٧٠٧٦.٥٠ (تحت التحصيل)",
        formatEGP(bal.inCollectionP), "7,076.50 ج");
    });

    // ⚠️ إعادة مزامنة الـ PWA — نفس الحدث → ack صامت، مش قيد مكرر
    await db.transaction(async (tx) => {
      const r = await applyTransition(tx, {
        shipmentId: SHIP, to: "delivered", actor: courier,
        deviceEventId: deviceEvent, source: "pwa",
        cod: { collectedP: P("7350"), method: "cash" },
        buildFinancialEntry: async () => buildDeliveryEntry({
          shipmentId: SHIP, merchantId: MERCHANT, courierId: COURIER, awb,
          codCollectedP: P("7350"), paymentMethod: "cash",
          shippingP: P("100"), codFeeP: P("173.50"), otherFeesP: 0n,
        }),
      });
      check("٩) إعادة مزامنة نفس الحدث → ack صامت", r.idempotentReplay, true);
      check("   مفيش قيد جديد اتكتب", r.journalEntryNo, "null");
    });

    // عدد القيود للشحنة لازم يكون ١ بالظبط
    const cnt = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM journal_entries WHERE source_id = ${SHIP}::uuid`;
    check("١٠) الشحنة ليها قيد واحد بالظبط (مش مكرر)", cnt[0]?.n, 1);

    // ⚠️ نفس الحدث بمبلغ مختلف → AMOUNT_MISMATCH
    await expectReject("١١) نفس الحدث بمبلغ مختلف → AMOUNT_MISMATCH", "AMOUNT_MISMATCH", () =>
      db.transaction((tx) =>
        applyTransition(tx, {
          shipmentId: SHIP, to: "delivered", actor: courier, deviceEventId: deviceEvent,
          cod: { collectedP: P("7000"), method: "cash" },
          buildFinancialEntry: async () => buildDeliveryEntry({
            shipmentId: SHIP, merchantId: MERCHANT, courierId: COURIER, awb,
            codCollectedP: P("7000"), paymentMethod: "cash",
            shippingP: P("100"), codFeeP: P("173.50"), otherFeesP: 0n,
          }),
        })
      )
    );

    // ⚠️ الحالة النهائية مقفولة
    await expectReject("١٢) الشحنة في حالة نهائية — أي تحول بيرفض", "NOT_ALLOWED", () =>
      db.transaction((tx) =>
        applyTransition(tx, { shipmentId: SHIP, to: "at_hub", actor: ops })
      )
    );

    // ⚠️ القفل التفاؤلي
    await expectReject("١٣) نسخة قديمة → VERSION_CONFLICT", "VERSION_CONFLICT", () =>
      db.transaction((tx) =>
        applyTransition(tx, { shipmentId: SHIP, to: "at_hub", actor: ops, expectedVersion: 1 })
      )
    );

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل الفحوصات نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error("\n❌ الاختبار وقع:");
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
