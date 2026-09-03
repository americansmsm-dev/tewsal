/**
 * ============================================================
 *  نقل الأوردرات القديمة للقاعدة الجديدة لرسوم التحصيل
 * ------------------------------------------------------------
 *  القاعدة الجديدة: رسوم التحصيل بتتخصم **مرة واحدة على إجمالي
 *  الفاتورة** — مش على كل أوردر.
 *
 *  السكربت بيعالج حالتين وبيسيب التالت:
 *   (أ) أوردر لسه ماتسلّمش وعليه بند رسوم تحصيل مسجّل:
 *       بنلغي البند (voided) ونصلّح لقطة الرسوم/الصافي على الشحنة.
 *       مفيش أثر على الدفتر (الرسوم بتتقيّد وقت التسليم).
 *   (ب) أوردر اتسلّم واتخصم منه تحصيل في الدفتر ولسه ماتسوّاش:
 *       **قيد تصحيح** (مدين إيراد التحصيل / دائن مستحقات التاجر)
 *       يرجّع الرسم — عشان يتحسب مرة واحدة مع الفاتورة بدل مرتين.
 *       الدفتر إضافة-فقط: مفيش حذف.
 *   (ج) أوردر اتسوّى/اتدفع خلاص: **مش بنلمسه** — تاريخي واتفوتر
 *       بالقاعدة القديمة.
 *
 *  التشغيل:  npx tsx scripts/migrate-cod-fee.ts [--apply]
 *  من غير --apply بيعمل **بروفة** (بيعرض بس من غير ما يغيّر).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { buildCodFeeAdjustmentEntry } from "@/server/domain/ledger";
import { postEntry } from "@/server/services/ledger";

const APPLY = process.argv.includes("--apply");
const egp = (p: bigint | string) => (Number(p) / 100).toFixed(2);

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

async function main() {
  console.log("═".repeat(58));
  console.log("  نقل الأوردرات القديمة لقاعدة رسوم التحصيل الجديدة");
  console.log(`  الوضع: ${APPLY ? "🔴 تنفيذ فعلي" : "🟡 بروفة (من غير تغيير)"}`);
  console.log("═".repeat(58));

  // ── (أ) أوردرات لسه ماتسلّمتش وعليها بند رسوم تحصيل ──
  const pending = rowsOf<{ id: string; awb: string; fee_id: string; amount_p: string }>(
    await db.execute(sql`
      SELECT sh.id, sh.awb, f.id AS fee_id, f.amount_p::text AS amount_p
      FROM shipments sh
      JOIN shipment_fees f ON f.shipment_id = sh.id AND f.fee_code = 'COD' AND f.voided_at IS NULL
      WHERE sh.status NOT IN ('delivered','partially_delivered')
        AND sh.is_settled = false
    `)
  );
  const sumA = pending.reduce((s, r) => s + BigInt(r.amount_p), 0n);
  console.log(`\n(أ) أوردرات لسه ماتسلّمتش وعليها رسوم تحصيل: ${pending.length} — إجمالي ${egp(sumA)} ج`);
  if (APPLY) {
    for (const r of pending) {
      await db.execute(sql`
        UPDATE shipment_fees SET voided_at = now(),
          void_reason = 'رسوم التحصيل بقت على إجمالي الفاتورة'
        WHERE id = ${r.fee_id}::uuid
      `);
      await db.execute(sql`
        UPDATE shipments
        SET total_fees_p = total_fees_p - ${r.amount_p}::bigint,
            merchant_net_p = merchant_net_p + ${r.amount_p}::bigint,
            updated_at = now()
        WHERE id = ${r.id}::uuid
      `);
    }
    console.log(`    ✅ اتلغى ${pending.length} بند واتصلّحت لقطة الرسوم/الصافي`);
  }

  // ── (ب) أوردرات اتسلّمت واتخصم منها تحصيل ولسه ماتسوّتش ──
  const charged = rowsOf<{ shipment_id: string; awb: string; merchant_id: string; fee_p: string }>(
    await db.execute(sql`
      SELECT jl.shipment_id, sh.awb, sh.merchant_id::text AS merchant_id, SUM(jl.credit_p)::text AS fee_p
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      JOIN shipments sh ON sh.id = jl.shipment_id
      WHERE a.code = 'REVENUE_COD_FEE' AND jl.credit_p > 0
        AND sh.is_settled = false
        AND sh.status IN ('delivered','partially_delivered')
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je2
          WHERE je2.kind = 'cod_fee_adjustment' AND je2.source_id = sh.id
        )
      GROUP BY jl.shipment_id, sh.awb, sh.merchant_id
    `)
  );
  const sumB = charged.reduce((s, r) => s + BigInt(r.fee_p), 0n);
  console.log(`\n(ب) أوردرات اتسلّمت واتخصم منها تحصيل ولسه ماتسوّتش: ${charged.length} — إجمالي ${egp(sumB)} ج`);
  console.log("    (دي اللي كانت هتتخصم مرتين — بيرجعلها الرسم بقيد تصحيح)");
  if (APPLY) {
    let done = 0;
    for (const r of charged) {
      const amountP = BigInt(r.fee_p);
      if (amountP <= 0n) continue;
      // ⚠️ قيد التوازن في القاعدة DEFERRABLE — لازم كل قيد جوّه ترانزاكشن
      await db.transaction(async (tx) =>
        postEntry(
          tx,
          buildCodFeeAdjustmentEntry({
            shipmentId: r.shipment_id,
            merchantId: r.merchant_id,
            amountP,
            memo: `تصحيح: رسوم التحصيل بقت على إجمالي الفاتورة (${r.awb})`,
          }),
          {}
        )
      );
      done++;
    }
    console.log(`    ✅ اتعمل ${done} قيد تصحيح`);
  }

  // ── (ج) المتسوّى — تاريخي ──
  const settled = rowsOf<{ n: number }>(
    await db.execute(sql`
      SELECT COUNT(DISTINCT jl.shipment_id)::int AS n
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      JOIN shipments sh ON sh.id = jl.shipment_id
      WHERE a.code = 'REVENUE_COD_FEE' AND jl.credit_p > 0 AND sh.is_settled = true
    `)
  )[0];
  console.log(`\n(ج) أوردرات اتسوّت خلاص: ${settled?.n ?? 0} — **مش بنلمسها** (اتفوترت بالقاعدة القديمة)`);

  console.log("\n" + "─".repeat(58));
  console.log(APPLY ? "✅ خلص. شغّل npm run invariants للتأكد." : "🟡 دي بروفة. للتنفيذ:  npx tsx scripts/migrate-cod-fee.ts --apply");
  console.log("─".repeat(58));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    process.exit(1);
  });
