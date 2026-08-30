/**
 * ============================================================
 *  تقرير التشغيل الظل — مرحلة ك (بوابة الفلوس الحقيقية)
 * ------------------------------------------------------------
 *  بيحسب — قراءة فقط، من غير ما يقيّد أو يدفع حاجة — اللي السيستم
 *  *هيدفعه* لكل تاجر لو عملت تسوية بتاريخ قطع معيّن. الهدف:
 *  تقارن الرقم ده سطر بسطر بحساباتك على الورق/الإكسل لمدة أسبوعين.
 *  لو طابقوا للقرش دورتين متتاليتين → السيستم جاهز للفلوس الحقيقية.
 *
 *  بيستخدم **نفس منطق الأهلية بالظبط** بتاع runSettlement (بدون
 *  FOR UPDATE وبدون أي كتابة) عشان الأرقام تبقى مطابقة للتسوية الفعلية.
 *
 *  الاستخدام:
 *    npx tsx scripts/shadow-settlement.ts                 # قطع = دلوقتي
 *    npx tsx scripts/shadow-settlement.ts 2026-08-28      # قطع بتاريخ
 *    npx tsx scripts/shadow-settlement.ts 2026-08-28 --detail   # بالشحنات
 * ============================================================
 */
import postgres from "postgres";

function egp(p: bigint): string {
  const neg = p < 0n; const a = neg ? -p : p;
  return `${neg ? "-" : ""}${(a / 100n).toLocaleString("en-US")}.${(a % 100n).toString().padStart(2, "0")}`;
}
function pad(s: string, n: number): string {
  const len = [...s].length;
  return len >= n ? s : s + " ".repeat(n - len);
}

async function main() {
  const arg = process.argv[2];
  const detail = process.argv.includes("--detail");
  const cutoff = arg && /^\d{4}-\d{2}-\d{2}/.test(arg) ? new Date(arg + "T23:59:59Z").toISOString() : new Date().toISOString();
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });

  try {
    // نفس CTE بتاع runSettlement، لكن لكل التجار ومن غير قفل/كتابة
    const rows = await sql<{
      merchant_id: string; name_ar: string; code: string;
      shipment_id: string; awb: string;
      cod_collected_p: string | null; total_fees_p: string; net_p: string; kind: string;
    }[]>`
      WITH closing AS (
        SELECT je.source_id AS shipment_id, je.entry_date, je.kind
        FROM journal_entries je
        WHERE je.source_type='shipment'
          AND je.kind IN ('delivery','partial_delivery','return','cancellation')
          AND je.is_reversal=false
          AND NOT EXISTS (
            SELECT 1 FROM journal_entries r
            WHERE r.source_type=je.source_type AND r.source_id=je.source_id
              AND r.kind=je.kind||'_reversal' AND r.is_reversal=true
          )
      ),
      last_handover AS (
        SELECT a.owner_id AS courier_id, MAX(je.entry_date) AS confirmed_until
        FROM journal_entries je
        JOIN journal_lines jl ON jl.entry_id=je.id
        JOIN accounts a ON a.id=jl.account_id
        WHERE je.kind='handover' AND a.code='COURIER_CASH'
        GROUP BY a.owner_id
      ),
      payable AS (
        SELECT jl.shipment_id, SUM(jl.credit_p - jl.debit_p) AS net_p
        FROM journal_lines jl
        JOIN accounts a ON a.id=jl.account_id
        WHERE a.code='MERCHANT_PAYABLE'
        GROUP BY jl.shipment_id
      )
      SELECT s.merchant_id, m.name_ar, m.code,
             s.id AS shipment_id, s.awb,
             s.cod_collected_p::text, s.total_fees_p::text,
             COALESCE(p.net_p,0)::text AS net_p, c.kind
      FROM shipments s
      JOIN closing c ON c.shipment_id=s.id
      JOIN merchants m ON m.id=s.merchant_id
      LEFT JOIN payable p ON p.shipment_id=s.id
      LEFT JOIN last_handover lh ON lh.courier_id=s.current_courier_id
      WHERE s.is_settled=false
        AND c.entry_date <= ${cutoff}
        AND (
          s.cod_method IS DISTINCT FROM 'cash'
          OR c.kind IN ('return','cancellation')
          OR (lh.confirmed_until IS NOT NULL AND c.entry_date <= lh.confirmed_until)
        )
      ORDER BY m.name_ar, s.created_at ASC
    `;

    // تجميع لكل تاجر
    const byMerchant = new Map<string, {
      name: string; code: string; n: number;
      gross: bigint; fees: bigint; net: bigint;
      items: { awb: string; kind: string; cod: bigint; fees: bigint; net: bigint }[];
    }>();
    for (const r of rows) {
      let m = byMerchant.get(r.merchant_id);
      if (!m) { m = { name: r.name_ar, code: r.code, n: 0, gross: 0n, fees: 0n, net: 0n, items: [] }; byMerchant.set(r.merchant_id, m); }
      const cod = BigInt(r.cod_collected_p ?? "0"), fees = BigInt(r.total_fees_p), net = BigInt(r.net_p);
      m.n++; m.gross += cod; m.fees += fees; m.net += net;
      if (detail) m.items.push({ awb: r.awb, kind: r.kind, cod, fees, net });
    }

    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`  تقرير التشغيل الظل — قطع حتى: ${cutoff.slice(0, 19).replace("T", " ")} UTC`);
    console.log(`  (اللي السيستم هيدفعه لو عملت تسوية دلوقتي — قارنه بالورق)`);
    console.log(`═══════════════════════════════════════════════════════════════\n`);

    if (byMerchant.size === 0) {
      console.log("  مفيش تجار عندهم شحنات مؤهّلة للتسوية بالتاريخ ده.\n");
      await sql.end(); return;
    }

    console.log(`  ${pad("التاجر", 22)}${pad("كود", 10)}${pad("شحنات", 8)}${pad("تحصيل", 15)}${pad("رسوم", 13)}صافي مستحق`);
    console.log("  " + "─".repeat(78));

    let gGross = 0n, gFees = 0n, gNetPay = 0n, gCarry = 0n, payCount = 0, carryCount = 0;
    // التجار اللي صافيهم موجب = هيتدفعوا؛ السالب/صفر = يترحّل (زي runSettlement)
    const sorted = [...byMerchant.values()].sort((a, b) => (b.net > a.net ? 1 : -1));
    for (const m of sorted) {
      const carry = m.net <= 0n;
      const flag = carry ? " ⏭️ يترحّل" : "";
      console.log(`  ${pad(m.name, 22)}${pad(m.code, 10)}${pad(String(m.n), 8)}${pad(egp(m.gross), 15)}${pad(egp(m.fees), 13)}${egp(m.net)}${flag}`);
      if (detail) {
        for (const it of m.items) {
          console.log(`      • ${pad(it.awb, 16)} ${pad(it.kind, 16)} تحصيل ${pad(egp(it.cod), 12)} رسوم ${pad(egp(it.fees), 10)} صافي ${egp(it.net)}`);
        }
      }
      gGross += m.gross; gFees += m.fees;
      if (carry) { gCarry += m.net; carryCount++; } else { gNetPay += m.net; payCount++; }
    }

    console.log("  " + "─".repeat(78));
    console.log(`\n  📊 الإجمالي:`);
    console.log(`     • تجار هيتدفعوا: ${payCount} · إجمالي الدفع المتوقّع: ${egp(gNetPay)} ج`);
    console.log(`     • تجار يترحّلوا (صافي ≤ 0): ${carryCount} · إجمالي مرحّل: ${egp(gCarry)} ج`);
    console.log(`     • إجمالي التحصيل: ${egp(gGross)} ج · إجمالي الرسوم (إيراد توصّل): ${egp(gFees)} ج`);
    console.log(`\n  ✅ طابق كل صف بحساباتك على الورق. دورتين متتاليتين مطابقتين للقرش = جاهز للفلوس الحقيقية.\n`);

    await sql.end();
  } catch (err) {
    console.error("❌ فشل التقرير:", err instanceof Error ? err.message : err);
    await sql.end();
    process.exitCode = 1;
  }
}
main();
