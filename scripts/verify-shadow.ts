/**
 * تأكيد إن تقرير الظل مطابق للتسوية الفعلية runSettlement.
 * بيشغّل التسوية الحقيقية لتاجر جوّه ترانزاكشن ويرجّعها (ROLLBACK)،
 * وبيقارن gross/fees/net باللي التقرير الظل بيحسبه لنفس التاجر.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { runSettlement } from "../src/server/services/settlement";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal";
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  const cutoff = new Date();
  let pass = 0, fail = 0;
  const chk = (l: string, a: unknown, e: unknown) => {
    const ok = String(a) === String(e);
    console.log(`  ${ok ? "✅" : "❌"} ${l}${ok ? "" : ` (ظل=${e} فعلي=${a})`}`);
    ok ? pass++ : fail++;
  };
  try {
    // تاجر عنده شحنات مؤهّلة بالمنطق الكامل (نفس CTE بتاع runSettlement)
    const [m] = await client<{ merchant_id: string; name_ar: string }[]>`
      WITH closing AS (
        SELECT je.source_id AS shipment_id, je.entry_date, je.kind FROM journal_entries je
        WHERE je.source_type='shipment' AND je.kind IN ('delivery','partial_delivery','return','cancellation')
          AND je.is_reversal=false
          AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.source_type=je.source_type
            AND r.source_id=je.source_id AND r.kind=je.kind||'_reversal' AND r.is_reversal=true)),
      last_handover AS (
        SELECT a.owner_id AS courier_id, MAX(je.entry_date) AS confirmed_until FROM journal_entries je
        JOIN journal_lines jl ON jl.entry_id=je.id JOIN accounts a ON a.id=jl.account_id
        WHERE je.kind='handover' AND a.code='COURIER_CASH' GROUP BY a.owner_id)
      SELECT s.merchant_id, m.name_ar FROM shipments s
      JOIN merchants m ON m.id=s.merchant_id
      JOIN closing c ON c.shipment_id=s.id
      LEFT JOIN last_handover lh ON lh.courier_id=s.current_courier_id
      WHERE s.is_settled=false AND c.entry_date <= ${cutoff.toISOString()}
        AND (s.cod_method IS DISTINCT FROM 'cash' OR c.kind IN ('return','cancellation')
             OR (lh.confirmed_until IS NOT NULL AND c.entry_date <= lh.confirmed_until))
      GROUP BY s.merchant_id, m.name_ar LIMIT 1`;
    if (!m) { console.log("مفيش تاجر مؤهّل للاختبار"); await client.end(); return; }
    console.log(`\n═══ تأكيد تطابق تقرير الظل مع runSettlement ═══`);
    console.log(`  التاجر: ${m.name_ar}\n`);

    // تقرير الظل لنفس التاجر (نفس CTE، قراءة فقط)
    const [shadow] = await client<{ n: string; gross: string; fees: string; net: string }[]>`
      WITH closing AS (
        SELECT je.source_id AS shipment_id, je.entry_date, je.kind FROM journal_entries je
        WHERE je.source_type='shipment' AND je.kind IN ('delivery','partial_delivery','return','cancellation')
          AND je.is_reversal=false
          AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.source_type=je.source_type
            AND r.source_id=je.source_id AND r.kind=je.kind||'_reversal' AND r.is_reversal=true)),
      last_handover AS (
        SELECT a.owner_id AS courier_id, MAX(je.entry_date) AS confirmed_until FROM journal_entries je
        JOIN journal_lines jl ON jl.entry_id=je.id JOIN accounts a ON a.id=jl.account_id
        WHERE je.kind='handover' AND a.code='COURIER_CASH' GROUP BY a.owner_id),
      payable AS (
        SELECT jl.shipment_id, SUM(jl.credit_p - jl.debit_p) AS net_p FROM journal_lines jl
        JOIN accounts a ON a.id=jl.account_id WHERE a.code='MERCHANT_PAYABLE' GROUP BY jl.shipment_id)
      SELECT COUNT(*)::text AS n,
             COALESCE(SUM(s.cod_collected_p),0)::text AS gross,
             COALESCE(SUM(s.total_fees_p),0)::text AS fees,
             COALESCE(SUM(COALESCE(p.net_p,0)),0)::text AS net
      FROM shipments s JOIN closing c ON c.shipment_id=s.id
      LEFT JOIN payable p ON p.shipment_id=s.id
      LEFT JOIN last_handover lh ON lh.courier_id=s.current_courier_id
      WHERE s.merchant_id=${m.merchant_id}::uuid AND s.is_settled=false AND c.entry_date <= ${cutoff.toISOString()}
        AND (s.cod_method IS DISTINCT FROM 'cash' OR c.kind IN ('return','cancellation')
             OR (lh.confirmed_until IS NOT NULL AND c.entry_date <= lh.confirmed_until))`;

    // التسوية الفعلية جوّه ترانزاكشن مرجوعة (نفس نمط verify-aging: tx كـ SqlExecutor)
    let real: { grossCodP: string; totalFeesP: string; netPayableP: bigint; itemCount: number } | null = null;
    try {
      await db.transaction(async (tx) => {
        const summary = await runSettlement(tx, {
          merchantId: m.merchant_id, code: "SHADOW-TEST-" + Date.now(), cutoffAt: cutoff, actorUserId: null,
        });
        // gross/fees متخزّنين في صف التسوية — نقراهم جوّه نفس الترانزاكشن
        const [row] = await tx.execute<{ gross_cod_p: string; total_fees_p: string }>(
          sql`SELECT gross_cod_p::text, total_fees_p::text FROM settlements WHERE id=${summary.settlementId}::uuid`
        ) as unknown as { gross_cod_p: string; total_fees_p: string }[];
        real = { grossCodP: row!.gross_cod_p, totalFeesP: row!.total_fees_p, netPayableP: summary.netPayableP, itemCount: summary.itemCount };
        throw new Error("__ROLLBACK__"); // نرجّع كل حاجة — مفيش تسوية فعلية بتتكتب
      });
    } catch (e) {
      if (!(e instanceof Error && e.message === "__ROLLBACK__")) throw e;
    }

    if (!real) { console.log("❌ التسوية الفعلية مرجعتش ملخّص"); await client.end(); process.exitCode = 1; return; }
    const r = real as { grossCodP: string; totalFeesP: string; netPayableP: bigint; itemCount: number };
    chk("عدد الشحنات", shadow!.n, String(r.itemCount));
    chk("إجمالي التحصيل (gross)", shadow!.gross, r.grossCodP);
    chk("إجمالي الرسوم (fees)", shadow!.fees, r.totalFeesP);
    chk("صافي المستحق (net)", shadow!.net, r.netPayableP.toString());

    // نتأكد إن الترانزاكشن اترجعت فعلًا — مفيش تسوية اتكتبت
    const [left] = await client<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM settlements WHERE code LIKE 'SHADOW-TEST-%'`;
    chk("مفيش تسوية اتكتبت (rollback)", left!.n, "0");

    console.log(`\n${fail === 0 ? `✅ تقرير الظل مطابق للتسوية الفعلية (${pass})` : `❌ ${fail} اختلاف`}\n`);
    process.exitCode = fail === 0 ? 0 : 1;
    await client.end();
  } catch (err) {
    console.error("❌ وقع:", err instanceof Error ? err.stack : err);
    await client.end();
    process.exitCode = 1;
  }
}
main();
