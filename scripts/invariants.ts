/**
 * ============================================================
 *  الفحوصات المالية الليلية — Invariants
 * ------------------------------------------------------------
 *  بتقارن الدفتر بالواقع كل ليلة. أي انحراف = تنبيه فوري.
 *
 *  ⚠️ الفلسفة: الضمانات اللي في قاعدة البيانات بتمنع الغلط
 *     **وقت الكتابة**. الفحوصات دي بتمسك الغلط اللي دخل من
 *     أي طريق تاني — تعديل يدوي، استرجاع نسخة قديمة،
 *     أو بق في منطق مالي جديد.
 *
 *  بترجع كود خروج 1 لو أي فحص فشل — عشان تشتغل في cron
 *  وتبعت تنبيه.
 *
 *  الاستخدام: npm run invariants
 *             npm run invariants -- --json    (للمراقبة الآلية)
 * ============================================================
 */
import postgres from "postgres";
import { formatEGP } from "../src/lib/money";

const AS_JSON = process.argv.includes("--json");

type Severity = "critical" | "warning";

interface CheckResult {
  id: string;
  nameAr: string;
  severity: Severity;
  passed: boolean;
  /** إيه اللي يتعمل لو فشل */
  actionAr: string;
  details: string[];
}

const results: CheckResult[] = [];

function record(r: CheckResult) {
  results.push(r);
}

// ---------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL مش متعرّف");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });

  try {
    // ═══════════════════════════════════════════════════════
    // I1 — الدفتر متوازن كليًا ولكل قيد على حدة
    // ═══════════════════════════════════════════════════════
    // لو ده فشل، يبقى فيه حاجة كتبت في الدفتر من غير ما تعدي
    // على الـ constraint trigger — استرجاع نسخة أو تعديل مباشر.
    {
      const [total] = await sql<{ debit: string; credit: string }[]>`
        SELECT COALESCE(SUM(debit_p),0)::text AS debit,
               COALESCE(SUM(credit_p),0)::text AS credit
        FROM journal_lines
      `;
      const perEntry = await sql<{ entry_no: string; diff: string }[]>`
        SELECT je.entry_no::text,
               (SUM(jl.debit_p) - SUM(jl.credit_p))::text AS diff
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        GROUP BY je.entry_no
        HAVING SUM(jl.debit_p) <> SUM(jl.credit_p)
        ORDER BY je.entry_no LIMIT 20
      `;
      const balanced = total!.debit === total!.credit && perEntry.length === 0;
      record({
        id: "I1",
        nameAr: "الدفتر متوازن — المدين = الدائن",
        severity: "critical",
        passed: balanced,
        actionAr: "تنبيه فوري + تجميد التسويات — الدفتر اتعدّل من برّه السيستم",
        details: balanced
          ? [`الإجمالي ${formatEGP(BigInt(total!.debit))} على الطرفين`]
          : [
              `الإجمالي: مدين ${formatEGP(BigInt(total!.debit))} ≠ دائن ${formatEGP(BigInt(total!.credit))}`,
              ...perEntry.map((e) => `القيد ${e.entry_no}: فرق ${formatEGP(BigInt(e.diff))}`),
            ],
      });
    }

    // ═══════════════════════════════════════════════════════
    // I2 — عهدة كل مندوب موجبة
    // ═══════════════════════════════════════════════════════
    // كاش المندوب أصل — الرصيد السالب معناه إنه سلّم أكتر مما
    // حصّل. ده مستحيل ماديًا، فلو حصل يبقى فيه قيد ناقص.
    {
      const negative = await sql<{ owner_id: string; balance: string }[]>`
        SELECT a.owner_id::text, (SUM(jl.debit_p) - SUM(jl.credit_p))::text AS balance
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE a.code = 'COURIER_CASH'
        GROUP BY a.owner_id
        HAVING SUM(jl.debit_p) - SUM(jl.credit_p) < 0
      `;
      record({
        id: "I2",
        nameAr: "مفيش مندوب عهدته سالبة",
        severity: "critical",
        passed: negative.length === 0,
        actionAr: "مراجعة قيود المندوب — غالبًا تسليم عهدة اتقيّد من غير التحصيل",
        details: negative.map(
          (r) => `المندوب ${r.owner_id}: ${formatEGP(BigInt(r.balance))}`
        ),
      });
    }

    // ═══════════════════════════════════════════════════════
    // I3 — مندوب ماسك كاش فوق الحد أو من زمان
    // ═══════════════════════════════════════════════════════
    {
      const [limitRow] = await sql<{ value: string }[]>`
        SELECT value::text FROM settings WHERE key = 'courier.max_cash_hold_days'
      `;
      const maxDays = Number(limitRow?.value ?? 2);

      const stale = await sql<{ owner_id: string; balance: string; oldest: string; days: number }[]>`
        SELECT a.owner_id::text,
               (SUM(jl.debit_p) - SUM(jl.credit_p))::text AS balance,
               MIN(je.entry_date)::text AS oldest,
               EXTRACT(DAY FROM (now() - MIN(je.entry_date)))::int AS days
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE a.code = 'COURIER_CASH'
        GROUP BY a.owner_id
        HAVING SUM(jl.debit_p) - SUM(jl.credit_p) > 0
           AND EXTRACT(DAY FROM (now() - MIN(je.entry_date))) > ${maxDays}
      `;
      record({
        id: "I3",
        nameAr: `مفيش مندوب ماسك كاش أكتر من ${maxDays} يوم`,
        severity: "warning",
        passed: stale.length === 0,
        actionAr: "منع فتح كشف جديد للمندوب + رسالة واتساب",
        details: stale.map(
          (r) => `المندوب ${r.owner_id}: ${formatEGP(BigInt(r.balance))} من ${r.days} يوم`
        ),
      });
    }

    // ═══════════════════════════════════════════════════════
    // I4 — أرصدة التجار المخزّنة = المشتق من الدفتر
    // ═══════════════════════════════════════════════════════
    // ⚠️ أخطر فحص: لو الرقم اللي التاجر شايفه مختلف عن الدفتر،
    //    ممكن نحوّل غلط. الفشل هنا = تجميد التسويات فورًا.
    {
      const drift = await sql<{ merchant_id: string; cached: string; derived: string }[]>`
        WITH ledger AS (
          SELECT a.owner_id AS merchant_id,
                 (SUM(jl.credit_p) - SUM(jl.debit_p)) AS derived
          FROM journal_lines jl
          JOIN accounts a ON a.id = jl.account_id
          WHERE a.code = 'MERCHANT_PAYABLE'
          GROUP BY a.owner_id
        )
        SELECT COALESCE(mb.merchant_id, l.merchant_id)::text AS merchant_id,
               COALESCE(mb.payable_confirmed_p + mb.payable_in_collection_p, 0)::text AS cached,
               COALESCE(l.derived, 0)::text AS derived
        FROM merchant_balances mb
        FULL OUTER JOIN ledger l ON l.merchant_id = mb.merchant_id
        WHERE COALESCE(mb.payable_confirmed_p + mb.payable_in_collection_p, 0)
              <> COALESCE(l.derived, 0)
      `;
      record({
        id: "I4",
        nameAr: "أرصدة التجار المعروضة = الدفتر",
        severity: "critical",
        passed: drift.length === 0,
        actionAr: "⛔ تجميد التسويات فورًا + إعادة احتساب الأرصدة من الدفتر",
        details: drift.map(
          (r) =>
            `التاجر ${r.merchant_id}: معروض ${formatEGP(BigInt(r.cached))} ≠ دفتر ${formatEGP(BigInt(r.derived))}`
        ),
      });
    }

    // ═══════════════════════════════════════════════════════
    // I5 — كل شحنة مقفولة ماليًا ليها قيد واحد بالظبط
    // ═══════════════════════════════════════════════════════
    {
      // ⚠️ بنعدّ **قيود الإقفال** بس (تسليم/إرجاع/فقد) — الشحنة
      //    ممكن يبقى ليها قيد تعويض أو عمولة كمان، وده طبيعي.
      //    والقيد اللي اتعكس مبيتحسبش لأن أثره اتلغى.
      const orphans = await sql<{ awb: string; status: string; entries: number }[]>`
        WITH closing AS (
          SELECT je.source_id AS shipment_id, count(*)::int AS n
          FROM journal_entries je
          WHERE je.source_type = 'shipment'
            AND je.kind IN ('delivery','partial_delivery','return','loss','damage')
            AND je.is_reversal = false
            -- القيد اللي اتعكس مبيتحسبش
            AND NOT EXISTS (
              SELECT 1 FROM journal_entries r
              WHERE r.source_type = je.source_type
                AND r.source_id = je.source_id
                AND r.kind = je.kind || '_reversal'
                AND r.is_reversal = true
            )
          GROUP BY je.source_id
        )
        SELECT s.awb, s.status, COALESCE(c.n, 0) AS entries
        FROM shipments s
        LEFT JOIN closing c ON c.shipment_id = s.id
        WHERE s.status IN ('delivered','partially_delivered','returned_to_merchant','lost','damaged')
          AND COALESCE(c.n, 0) <> 1
        LIMIT 30
      `;
      record({
        id: "I5",
        nameAr: "كل شحنة مقفولة ماليًا ليها قيد واحد",
        severity: "critical",
        passed: orphans.length === 0,
        actionAr: "عرض الشحنات اليتيمة على المحاسب لتقييدها يدويًا",
        details: orphans.map(
          (r) => `${r.awb} (${r.status}): ${r.entries === 0 ? "مفيش قيد" : `${r.entries} قيود`}`
        ),
      });
    }

    // ═══════════════════════════════════════════════════════
    // I6 — مفيش شحنة في تسويتين
    // ═══════════════════════════════════════════════════════
    {
      const dupes = await sql<{ shipment_id: string; n: number }[]>`
        SELECT shipment_id::text, count(*)::int AS n
        FROM settlement_items
        GROUP BY shipment_id HAVING count(*) > 1 LIMIT 30
      `;
      record({
        id: "I6",
        nameAr: "مفيش شحنة اتحوّلت مرتين",
        severity: "critical",
        passed: dupes.length === 0,
        actionAr: "⛔ استرجاع المبلغ المكرر + مراجعة كود التسوية",
        details: dupes.map((r) => `الشحنة ${r.shipment_id} في ${r.n} تسويات`),
      });
    }

    // ═══════════════════════════════════════════════════════
    // I7 — مفيش تحصيل بمبلغ مختلف عن المسجّل من غير تسليم جزئي
    // ═══════════════════════════════════════════════════════
    // ⚠️ القبول الصامت لمبلغ مختلف = بالظبط إزاي الكاش بيضيع.
    {
      const mismatch = await sql<{ awb: string; expected: string; collected: string }[]>`
        SELECT awb, cod_amount_p::text AS expected, cod_collected_p::text AS collected
        FROM shipments
        WHERE status = 'delivered'
          AND cod_collected_p IS NOT NULL
          AND cod_collected_p <> cod_amount_p
        LIMIT 30
      `;
      record({
        id: "I7",
        nameAr: "مفيش تحصيل بمبلغ مختلف من غير تسليم جزئي",
        severity: "critical",
        passed: mismatch.length === 0,
        actionAr: "مراجعة المندوب — المفروض يختار «تسليم جزئي» صراحة",
        details: mismatch.map(
          (r) =>
            `${r.awb}: المسجّل ${formatEGP(BigInt(r.expected))} · المحصّل ${formatEGP(BigInt(r.collected))}`
        ),
      });
    }

    // ═══════════════════════════════════════════════════════
    // I8 — الزيادات النقدية المعلّقة لسه متحلّتش
    // ═══════════════════════════════════════════════════════
    // مش خطأ، بس فلوس مالهاش صاحب — لازم تتحل.
    {
      const [row] = await sql<{ balance: string }[]>`
        SELECT COALESCE(SUM(jl.credit_p) - SUM(jl.debit_p), 0)::text AS balance
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE a.code = 'CASH_OVER_SUSPENSE'
      `;
      const amount = BigInt(row?.balance ?? "0");
      record({
        id: "I8",
        nameAr: "مفيش زيادة نقدية معلّقة من غير تفسير",
        severity: "warning",
        passed: amount === 0n,
        actionAr: "المحاسب يحدد مصدر الزيادة ويرحّلها لحسابها الصح",
        details: amount === 0n ? [] : [`معلّق: ${formatEGP(amount)}`],
      });
    }

    // ═══════════════════════════════════════════════════════
    // I9 — ذمم المناديب (العجز) لسه مستحقة
    // ═══════════════════════════════════════════════════════
    {
      const debts = await sql<{ owner_id: string; balance: string }[]>`
        SELECT a.owner_id::text, (SUM(jl.debit_p) - SUM(jl.credit_p))::text AS balance
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE a.code = 'COURIER_RECEIVABLE'
        GROUP BY a.owner_id
        HAVING SUM(jl.debit_p) - SUM(jl.credit_p) > 0
      `;
      record({
        id: "I9",
        nameAr: "مفيش عجز مندوب لسه متسدّدش",
        severity: "warning",
        passed: debts.length === 0,
        actionAr: "خصم من العمولة أو تسوية مع المندوب",
        details: debts.map((r) => `المندوب ${r.owner_id}: ${formatEGP(BigInt(r.balance))}`),
      });
    }

    // ═══════════════════════════════════════════════════════
    // النتيجة
    // ═══════════════════════════════════════════════════════
    const failed = results.filter((r) => !r.passed);
    const criticalFailed = failed.filter((r) => r.severity === "critical");

    if (AS_JSON) {
      console.log(JSON.stringify({ results, failed: failed.length, critical: criticalFailed.length }, null, 2));
    } else {
      console.log("");
      console.log("═".repeat(58));
      console.log("  الفحوصات المالية الليلية — Tewsal");
      console.log("═".repeat(58));
      for (const r of results) {
        const icon = r.passed ? "✅" : r.severity === "critical" ? "⛔" : "⚠️ ";
        console.log(`\n${icon} ${r.id} — ${r.nameAr}`);
        for (const d of r.details) console.log(`     ${d}`);
        if (!r.passed) console.log(`     ↳ الإجراء: ${r.actionAr}`);
      }
      console.log("");
      console.log("─".repeat(58));
      if (failed.length === 0) {
        console.log(`✅ كل الفحوصات نظيفة (${results.length}) — فلوسك كلها في مكانها`);
      } else {
        console.log(
          `${criticalFailed.length > 0 ? "⛔" : "⚠️ "} ${failed.length} فحص محتاج انتباه` +
            (criticalFailed.length > 0 ? ` (منهم ${criticalFailed.length} حرج)` : "")
        );
      }
      console.log("─".repeat(58));
      console.log("");
    }

    // الحرج بس هو اللي بيوقف — التحذيرات بتتسجّل ومبتوقفش النشر
    process.exitCode = criticalFailed.length > 0 ? 1 : 0;
  } catch (err) {
    console.error("\n❌ الفحوصات نفسها وقعت:");
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
