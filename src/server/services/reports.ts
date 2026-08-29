/**
 * ============================================================
 *  تقارير الأعمار — Aging Reports
 * ------------------------------------------------------------
 *  «فلوس عندك ولسه ماوصلتش» مقسّمة بالعمر. أهم تقرير للكاش.
 *
 *  ١) أعمار كاش المناديب: كل مندوب ماسك كام كاش وبقاله قد إيه
 *     من غير ما يسلّم عهدته. الكاش «المعلّق» = تحصيلات كاش
 *     اتقيّدت **بعد آخر تسليم عهدة مؤكد** للمندوب — نفس قاعدة
 *     الخانتين في [[recomputeMerchantBalance]]. بنقسّمها بعمر
 *     يوم القيد (ساعة السيرفر).
 *
 *  ٢) أعمار مستحقات التجار تحت التحصيل: نفس المبدأ من ناحية
 *     التاجر — مستحقات اتسلّمت بس كاشها لسه مع المندوب.
 *
 *  الأرقام قروش خام (نص) — الواجهة هي اللي بتنسّق بـ formatEGP.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./ledger";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** حدود شرائح العمر (بالأيام). ٥ شرائح ثابتة عبر التقارير. */
export const AGING_BUCKETS = [
  { key: "b0", label: "اليوم" },
  { key: "b1", label: "١–٣ أيام" },
  { key: "b2", label: "٤–٧ أيام" },
  { key: "b3", label: "٨–١٤ يوم" },
  { key: "b4", label: "أكبر من أسبوعين" },
] as const;

export interface AgingRow {
  /** معرّف المندوب أو التاجر */
  id: string;
  name: string;
  /** ٥ شرائح — قروش خام كنص، بترتيب AGING_BUCKETS */
  bucketsP: [string, string, string, string, string];
  totalP: string;
  /** عمر أقدم مبلغ معلّق (أيام) — للترتيب والتنبيه */
  oldestDays: number;
}

export interface AgingReport {
  rows: AgingRow[];
  /** مجاميع الأعمدة (٥ شرائح) قروش خام */
  totalsP: [string, string, string, string, string];
  grandTotalP: string;
}

/** الـ CTE المشترك: آخر لحظة تأكّد فيها استلام عهدة كل مندوب */
const LAST_HANDOVER = sql`
  last_handover AS (
    SELECT a.owner_id AS courier_id, MAX(je.entry_date) AS confirmed_until
    FROM journal_entries je
    JOIN journal_lines jl ON jl.entry_id = je.id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.kind = 'handover' AND a.code = 'COURIER_CASH'
    GROUP BY a.owner_id
  )
`;

/** بنّاء شرائح: يجمع amount_p حسب عمود العمر age_days */
const bucketCols = sql`
  COALESCE(SUM(amount_p) FILTER (WHERE age_days <= 0), 0)::text            AS b0,
  COALESCE(SUM(amount_p) FILTER (WHERE age_days BETWEEN 1 AND 3), 0)::text  AS b1,
  COALESCE(SUM(amount_p) FILTER (WHERE age_days BETWEEN 4 AND 7), 0)::text  AS b2,
  COALESCE(SUM(amount_p) FILTER (WHERE age_days BETWEEN 8 AND 14), 0)::text AS b3,
  COALESCE(SUM(amount_p) FILTER (WHERE age_days >= 15), 0)::text            AS b4,
  COALESCE(SUM(amount_p), 0)::text                                          AS total,
  COALESCE(MAX(age_days), 0)::int                                           AS oldest_days
`;

interface RawRow {
  id: string;
  name: string | null;
  b0: string; b1: string; b2: string; b3: string; b4: string;
  total: string;
  oldest_days: number;
}

function toReport(raws: RawRow[], fallbackName: string): AgingReport {
  const rows: AgingRow[] = raws.map((r) => ({
    id: r.id,
    name: r.name ?? fallbackName,
    bucketsP: [r.b0, r.b1, r.b2, r.b3, r.b4],
    totalP: r.total,
    oldestDays: r.oldest_days,
  }));
  const totals = [0n, 0n, 0n, 0n, 0n];
  let grand = 0n;
  for (const r of rows) {
    for (let i = 0; i < 5; i++) totals[i]! += BigInt(r.bucketsP[i]!);
    grand += BigInt(r.totalP);
  }
  return {
    rows,
    totalsP: totals.map((t) => t.toString()) as AgingReport["totalsP"],
    grandTotalP: grand.toString(),
  };
}

/**
 * أعمار كاش المناديب — كل مندوب والكاش المعلّق في عهدته مقسّم بالعمر.
 * الكاش المعلّق = مدين «كاش المندوب» اللي اتقيّد بعد آخر تسليم عهدة.
 * مجموع الشرائح لكل مندوب = رصيد عهدته الحالي بالظبط.
 */
export async function courierCashAging(ex: SqlExecutor): Promise<AgingReport> {
  const raws = rowsOf<RawRow>(
    await ex.execute(sql`
      WITH ${LAST_HANDOVER},
      pending AS (
        SELECT ca.owner_id AS id,
               jl.debit_p  AS amount_p,
               GREATEST(0, (now()::date - je.entry_date::date)) AS age_days
        FROM journal_lines jl
        JOIN accounts ca ON ca.id = jl.account_id AND ca.code = 'COURIER_CASH'
        JOIN journal_entries je ON je.id = jl.entry_id
        LEFT JOIN last_handover lh ON lh.courier_id = ca.owner_id
        WHERE jl.debit_p > 0
          AND (lh.confirmed_until IS NULL OR je.entry_date > lh.confirmed_until)
      )
      SELECT p.id::text AS id, u.full_name AS name, ${bucketCols}
      FROM pending p
      LEFT JOIN users u ON u.id = p.id
      GROUP BY p.id, u.full_name
      HAVING COALESCE(SUM(amount_p), 0) > 0
      ORDER BY MAX(age_days) DESC, SUM(amount_p) DESC
    `)
  );
  return toReport(raws, "مندوب");
}

/**
 * أعمار مستحقات التجار تحت التحصيل — لكل تاجر، المستحقات اللي
 * اتسلّمت بس كاشها لسه مع المندوب، مقسّمة بعمر يوم التسليم.
 * صافي مستحق القيد = مجموع (دائن − مدين) على «مستحقات التاجر».
 */
export async function merchantReceivablesAging(ex: SqlExecutor): Promise<AgingReport> {
  const raws = rowsOf<RawRow>(
    await ex.execute(sql`
      WITH ${LAST_HANDOVER},
      -- قيود فيها كاش لسه في عهدة مندوب (بعد آخر تسليم عهدة)
      pending_entries AS (
        SELECT DISTINCT je.id AS entry_id, je.entry_date
        FROM journal_entries je
        JOIN journal_lines cash ON cash.entry_id = je.id AND cash.debit_p > 0
        JOIN accounts ca ON ca.id = cash.account_id AND ca.code = 'COURIER_CASH'
        LEFT JOIN last_handover lh ON lh.courier_id = ca.owner_id
        WHERE lh.confirmed_until IS NULL OR je.entry_date > lh.confirmed_until
      ),
      per_entry AS (
        SELECT mp.owner_id AS id,
               SUM(mpl.credit_p - mpl.debit_p) AS amount_p,
               GREATEST(0, (now()::date - pe.entry_date::date)) AS age_days
        FROM pending_entries pe
        JOIN journal_lines mpl ON mpl.entry_id = pe.entry_id
        JOIN accounts mp ON mp.id = mpl.account_id AND mp.code = 'MERCHANT_PAYABLE'
        GROUP BY mp.owner_id, pe.entry_id, pe.entry_date
      )
      SELECT pe.id::text AS id, m.name_ar AS name, ${bucketCols}
      FROM per_entry pe
      LEFT JOIN merchants m ON m.id = pe.id
      GROUP BY pe.id, m.name_ar
      HAVING COALESCE(SUM(amount_p), 0) > 0
      ORDER BY MAX(age_days) DESC, SUM(amount_p) DESC
    `)
  );
  return toReport(raws, "تاجر");
}
