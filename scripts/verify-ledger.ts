/**
 * ============================================================
 *  اختبار الدفتر على قاعدة بيانات حقيقية
 * ------------------------------------------------------------
 *  بيمثّل دورة كاملة: تسليم → عهدة → إيداع → تسوية،
 *  وبيتأكد إن الأرصدة النهائية مظبوطة **والدفتر متوازن**.
 *
 *  ⚠️ ده مش unit test — ده بيثبت إن الضمانات اللي في
 *     قاعدة البيانات شغالة فعلًا، مش بس في الكود.
 *
 *  الاستخدام: npx tsx scripts/verify-ledger.ts
 * ============================================================
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { formatEGP, poundsToPiastres as P } from "../src/lib/money";
import {
  ACC,
  buildDeliveryEntry,
  buildReturnEntry,
  buildHandoverEntry,
  buildBankDepositEntry,
  buildPayoutEntry,
  buildReversalEntry,
} from "../src/server/domain/ledger";
import { postEntry, accountBalance, recomputeMerchantBalance } from "../src/server/services/ledger";
import { buildAwb, isValidAwb } from "../src/lib/awb";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `\n       المتوقع: ${expected}\n       الفعلي:  ${actual}`}`);
  ok ? pass++ : fail++;
}

// ---------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL مش متعرّف");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  // معرّفات وهمية ثابتة عشان النتيجة تتكرر
  const MERCHANT = "aaaaaaaa-0000-4000-8000-000000000001";
  const COURIER = "bbbbbbbb-0000-4000-8000-000000000001";
  const SHIPMENT_A = "cccccccc-0000-4000-8000-00000000000a";
  const SHIPMENT_B = "cccccccc-0000-4000-8000-00000000000b";
  const HANDOVER = "dddddddd-0000-4000-8000-000000000001";
  const SETTLEMENT = "eeeeeeee-0000-4000-8000-000000000001";

  try {
    const [branch] = await sql<{ id: string }[]>`SELECT id FROM branches WHERE code = 'MAIN'`;
    if (!branch) throw new Error("الفرع الرئيسي مش موجود — شغّل db:seed");
    const BRANCH = branch.id;

    // شحنتين حقيقيتين — الدفتر مربوط بيهم بمفتاح أجنبي
    const [gov] = await sql<{ id: string; zone_id: string }[]>`
      SELECT id, zone_id FROM governorates WHERE code = 'CAI'`;
    if (!gov) throw new Error("محافظة القاهرة مش موجودة — شغّل db:seed");

    console.log("\n═══ ٠) توليد رقم بوليصة من تسلسل قاعدة البيانات ═══");
    const awbs: string[] = [];
    for (const id of [SHIPMENT_A, SHIPMENT_B]) {
      const [seq] = await sql<{ nextval: string }[]>`SELECT nextval('awb_sequence')`;
      const awb = buildAwb(Number(seq!.nextval), 2026);
      awbs.push(awb);
      await sql`
        INSERT INTO shipments (id, awb, merchant_id, recipient_name, recipient_phone,
                               governorate_id, zone_id, address_line, status)
        VALUES (${id}::uuid, ${awb}, ${MERCHANT}::uuid, 'أحمد محمود', '01012345678',
                ${gov.id}::uuid, ${gov.zone_id}::uuid, 'شارع التحرير، وسط البلد', 'delivered')
        ON CONFLICT (id) DO UPDATE SET awb = EXCLUDED.awb
      `;
    }
    check(`رقم البوليصة ${awbs[0]} صالح (check digit)`, isValidAwb(awbs[0]!), true);
    check(`رقم البوليصة ${awbs[1]} صالح`, isValidAwb(awbs[1]!), true);
    check("الرقمين مختلفين", awbs[0] !== awbs[1], true);

    // تنظيف أي تشغيل سابق (بيانات اختبار بس)
    await sql`DELETE FROM journal_lines WHERE entry_id IN (
      SELECT id FROM journal_entries WHERE source_id::text IN
        (${SHIPMENT_A}, ${SHIPMENT_B}, ${HANDOVER}, ${SETTLEMENT}))`;
    await sql`ALTER TABLE journal_entries DISABLE TRIGGER trg_je_immutable`;
    await sql`DELETE FROM journal_entries WHERE source_id::text IN
      (${SHIPMENT_A}, ${SHIPMENT_B}, ${HANDOVER}, ${SETTLEMENT})`;
    await sql`ALTER TABLE journal_entries ENABLE TRIGGER trg_je_immutable`;

    console.log("\n═══ ١) تسليم شحنة: تحصيل ٧٣٥٠ ج · شحن ١٠٠ ج · رسوم تحصيل ١٧٣.٥٠ ج ═══");
    await db.transaction(async (tx) => {
      const ex = tx;
      const { entryNo } = await postEntry(
        ex,
        buildDeliveryEntry({
          shipmentId: SHIPMENT_A, merchantId: MERCHANT, courierId: COURIER,
          awb: awbs[0]!, codCollectedP: P("7350"), paymentMethod: "cash",
          shippingP: P("100"), codFeeP: P("173.50"), otherFeesP: 0n,
        })
      );
      console.log(`  📒 اتكتب القيد رقم ${entryNo}`);
    });

    console.log("\n═══ ٢) شحنة تانية بفودافون كاش: تحصيل ٢٠٠٠ ج · شحن ٩٠ ج · رسوم ١٠٠ ج ═══");
    await db.transaction(async (tx) => {
      await postEntry(
        tx,
        buildDeliveryEntry({
          shipmentId: SHIPMENT_B, merchantId: MERCHANT, courierId: COURIER,
          awb: awbs[1]!, codCollectedP: P("2000"), paymentMethod: "vodafone_cash",
          shippingP: P("90"), codFeeP: P("100"), otherFeesP: 0n,
        })
      );
    });

    await db.transaction(async (tx) => {
      const ex = tx;
      console.log("\n  الأرصدة بعد التسليمتين:");
      check("كاش المندوب = ٧٣٥٠ (الفودافون مدخلش عهدته)",
        formatEGP(await accountBalance(ex, ACC.courierCash(COURIER))), "7,350.00 ج");
      check("محفظة فودافون = ٢٠٠٠",
        formatEGP(await accountBalance(ex, ACC.walletVodafone())), "2,000.00 ج");
      check("مستحقات التاجر = ٨٨٨٦.٥٠ (رصيد دائن)",
        formatEGP(-(await accountBalance(ex, ACC.merchantPayable(MERCHANT)))), "8,886.50 ج");
      check("إيراد الشحن = ١٩٠",
        formatEGP(-(await accountBalance(ex, ACC.revenueShipping()))), "190.00 ج");
      check("إيراد التحصيل = ٢٧٣.٥٠",
        formatEGP(-(await accountBalance(ex, ACC.revenueCodFee()))), "273.50 ج");

      // ⚠️ الخانتين اللي التاجر بيشوفهم — أهم حاجة في الشفافية
      console.log("\n  كشف التاجر (قبل ما المندوب يسلّم عهدته):");
      const b = await recomputeMerchantBalance(ex, MERCHANT);
      check("✅ مؤكد = ١٨١٠ (الفودافون وصل الشركة فورًا)",
        formatEGP(b.confirmedP), "1,810.00 ج");
      check("⏳ تحت التحصيل = ٧٠٧٦.٥٠ (لسه مع المندوب)",
        formatEGP(b.inCollectionP), "7,076.50 ج");
      check("المجموع = إجمالي المستحقات",
        formatEGP(b.confirmedP + b.inCollectionP), "8,886.50 ج");
    });

    console.log("\n═══ ٣) نفس التسليم يتقيّد تاني — لازم يترفض ═══");
    try {
      await db.transaction(async (tx) => {
        await postEntry(
          tx,
          buildDeliveryEntry({
            shipmentId: SHIPMENT_A, merchantId: MERCHANT, courierId: COURIER,
            awb: awbs[0]!, codCollectedP: P("7350"), paymentMethod: "cash",
            shippingP: P("100"), codFeeP: P("173.50"), otherFeesP: 0n,
          })
        );
      });
      check("القيد المكرر اترفض", "اتقبل!", "اترفض");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      check("القيد المكرر اترفض برسالة عربية", msg.includes("اتقيّدت قبل كده"), true);
    }

    console.log("\n═══ ٤) المندوب يسلّم عهدته وفيها عجز ٥٠ ج ═══");
    await db.transaction(async (tx) => {
      const ex = tx;
      const expected = await accountBalance(ex, ACC.courierCash(COURIER));
      await postEntry(
        ex,
        buildHandoverEntry({
          handoverId: HANDOVER, courierId: COURIER, branchId: BRANCH,
          expectedP: expected, receivedP: expected - P("50"),
        })
      );
      check("عهدة المندوب اتصفّت", formatEGP(await accountBalance(ex, ACC.courierCash(COURIER))), "0.00 ج");
      check("العجز بقى ذمة على المندوب ٥٠ ج",
        formatEGP(await accountBalance(ex, ACC.courierReceivable(COURIER))), "50.00 ج");
      check("خزنة الفرع = ٧٣٠٠",
        formatEGP(await accountBalance(ex, ACC.branchCash(BRANCH))), "7,300.00 ج");

      // ⚠️ دلوقتي الكاش وصل الشركة — لازم ينتقل للخانة المؤكدة
      console.log("\n  كشف التاجر (بعد تسليم العهدة):");
      const b = await recomputeMerchantBalance(ex, MERCHANT);
      check("✅ مؤكد بقى ٨٨٨٦.٥٠ — كل المستحقات",
        formatEGP(b.confirmedP), "8,886.50 ج");
      check("⏳ تحت التحصيل بقى صفر", formatEGP(b.inCollectionP), "0.00 ج");
      check("⚠️ الرقم المؤكد زاد ومقلّش أبدًا",
        b.confirmedP > P("1810"), true);
    });

    console.log("\n═══ ٥) إيداع بنكي بالمبلغ اللي في الخزنة ═══");
    await db.transaction(async (tx) => {
      const ex = tx;
      await postEntry(ex, buildBankDepositEntry({ handoverId: HANDOVER, branchId: BRANCH, amountP: P("7300") }));
      check("الخزنة فضيت", formatEGP(await accountBalance(ex, ACC.branchCash(BRANCH))), "0.00 ج");
      check("البنك = ٧٣٠٠", formatEGP(await accountBalance(ex, ACC.companyBank())), "7,300.00 ج");
    });

    console.log("\n═══ ٦) مرتجع: شحن ١٠٠ + رسم مرتجع ١٠٠ ═══");
    await db.transaction(async (tx) => {
      const ex = tx;
      await postEntry(ex, buildReturnEntry({
        shipmentId: SHIPMENT_B, merchantId: MERCHANT, awb: awbs[1]!,
        shippingP: P("100"), returnFeeP: P("100"),
      }));
      check("مستحقات التاجر قلّت ٢٠٠ → ٨٦٨٦.٥٠",
        formatEGP(-(await accountBalance(ex, ACC.merchantPayable(MERCHANT)))), "8,686.50 ج");
    });

    console.log("\n═══ ٧) تحويل مستحقات التاجر بنكيًا ═══");
    await db.transaction(async (tx) => {
      const ex = tx;
      const due = -(await accountBalance(ex, ACC.merchantPayable(MERCHANT)));
      await postEntry(ex, buildPayoutEntry({
        settlementId: SETTLEMENT, merchantId: MERCHANT, code: "STL-2026-0001",
        netPayableP: due, method: "bank",
      }));
      check("مستحقات التاجر بقت صفر",
        formatEGP(await accountBalance(ex, ACC.merchantPayable(MERCHANT))), "0.00 ج");
    });

    console.log("\n═══ ٨) قيد عكسي لتصحيح المرتجع ═══");
    await db.transaction(async (tx) => {
      const ex = tx;
      const original = buildReturnEntry({
        shipmentId: SHIPMENT_B, merchantId: MERCHANT, awb: awbs[1]!,
        shippingP: P("100"), returnFeeP: P("100"),
      });
      await postEntry(ex, buildReversalEntry(original, "الشحنة اترجعت بالغلط — اتسلّمت فعلًا"));
      check("إيراد المرتجع رجع صفر",
        formatEGP(await accountBalance(ex, ACC.revenueReturnFee())), "0.00 ج");
    });

    console.log("\n═══ ٩) ميزان المراجعة — المدين لازم = الدائن ═══");
    const [trial] = await sql<{ debit: string; credit: string; entries: number }[]>`
      SELECT COALESCE(SUM(debit_p),0)::text AS debit,
             COALESCE(SUM(credit_p),0)::text AS credit,
             (SELECT count(*) FROM journal_entries)::int AS entries
      FROM journal_lines
    `;
    console.log(`  عدد القيود: ${trial!.entries}`);
    console.log(`  إجمالي المدين:  ${formatEGP(BigInt(trial!.debit))}`);
    console.log(`  إجمالي الدائن:  ${formatEGP(BigInt(trial!.credit))}`);
    check("الميزان متوازن", trial!.debit, trial!.credit);

    console.log("\n═══ ١٠) كل قيد على حدة متوازن ═══");
    const unbalanced = await sql<{ id: string; d: string; c: string }[]>`
      SELECT entry_id AS id, SUM(debit_p)::text AS d, SUM(credit_p)::text AS c
      FROM journal_lines GROUP BY entry_id HAVING SUM(debit_p) <> SUM(credit_p)
    `;
    check("مفيش ولا قيد غير متوازن", unbalanced.length, 0);

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
