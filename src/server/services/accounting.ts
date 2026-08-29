/**
 * ============================================================
 *  التقارير المحاسبية — Accounting Reports (قراءة فقط)
 * ------------------------------------------------------------
 *  كلها مشتقّة من الدفتر المزدوج مباشرة — مصدر واحد للحقيقة.
 *  ⚠️ مفيش أي كتابة هنا. النواة ماتتلمسش.
 *
 *  trialBalance   — ميزان المراجعة (لازم يتوازن: مدين = دائن)
 *  profitAndLoss  — الأرباح والخسائر (إيراد − مصروف)
 *  revenueByType  — الإيرادات حسب النوع
 *  journal        — دفتر اليومية (آخر القيود)
 *
 *  الأرقام قروش خام (نص) — الواجهة بتنسّق بـ formatEGP.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./ledger";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export const ACCOUNT_TYPE_LABELS_AR: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  revenue: "إيرادات",
  expense: "مصروفات",
  equity: "حقوق ملكية",
};

// ---------------------------------------------------------------
// ميزان المراجعة
// ---------------------------------------------------------------

export interface TrialBalanceRow {
  code: string;
  nameAr: string;
  type: string;
  debitP: string;
  creditP: string;
  /** الرصيد الصافي (مدين − دائن) — موجب مدين، سالب دائن */
  balanceP: string;
}
export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitP: string;
  totalCreditP: string;
  /** لازم true — وإلا فيه خلل في الدفتر */
  balanced: boolean;
}

/**
 * ميزان المراجعة — مجمّع بكود الحساب (كل المناديب في «كاش المندوب»،
 * كل التجار في «مستحقات التاجر»...). إجمالي المدين لازم = الدائن.
 */
export async function trialBalance(ex: SqlExecutor): Promise<TrialBalance> {
  const rows = rowsOf<{ code: string; name_ar: string; type: string; debit: string; credit: string }>(
    await ex.execute(sql`
      SELECT a.code,
             MIN(a.name_ar) AS name_ar,
             a.type,
             COALESCE(SUM(jl.debit_p), 0)::text  AS debit,
             COALESCE(SUM(jl.credit_p), 0)::text AS credit
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      GROUP BY a.code, a.type
      HAVING COALESCE(SUM(jl.debit_p), 0) <> 0 OR COALESCE(SUM(jl.credit_p), 0) <> 0
      ORDER BY
        CASE a.type WHEN 'asset' THEN 1 WHEN 'liability' THEN 2 WHEN 'equity' THEN 3
                    WHEN 'revenue' THEN 4 WHEN 'expense' THEN 5 ELSE 6 END,
        a.code
    `)
  );

  let td = 0n, tc = 0n;
  const out: TrialBalanceRow[] = rows.map((r) => {
    const d = BigInt(r.debit), c = BigInt(r.credit);
    td += d; tc += c;
    return { code: r.code, nameAr: r.name_ar, type: r.type, debitP: r.debit, creditP: r.credit, balanceP: (d - c).toString() };
  });
  return { rows: out, totalDebitP: td.toString(), totalCreditP: tc.toString(), balanced: td === tc };
}

// ---------------------------------------------------------------
// الأرباح والخسائر
// ---------------------------------------------------------------

export interface PnlLine { code: string; nameAr: string; amountP: string }
export interface ProfitAndLoss {
  revenue: PnlLine[];
  expense: PnlLine[];
  totalRevenueP: string;
  totalExpenseP: string;
  netProfitP: string;
}

/** الأرباح والخسائر: الإيراد (دائن) − المصروف (مدين) = الربح. */
export async function profitAndLoss(ex: SqlExecutor): Promise<ProfitAndLoss> {
  const rows = rowsOf<{ code: string; name_ar: string; type: string; amount: string }>(
    await ex.execute(sql`
      SELECT a.code, MIN(a.name_ar) AS name_ar, a.type,
             CASE WHEN a.type = 'revenue'
                  THEN COALESCE(SUM(jl.credit_p - jl.debit_p), 0)
                  ELSE COALESCE(SUM(jl.debit_p - jl.credit_p), 0) END::text AS amount
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.type IN ('revenue', 'expense')
      GROUP BY a.code, a.type
      HAVING COALESCE(SUM(jl.debit_p), 0) <> 0 OR COALESCE(SUM(jl.credit_p), 0) <> 0
      ORDER BY a.type, a.code
    `)
  );
  const revenue: PnlLine[] = [], expense: PnlLine[] = [];
  let tr = 0n, te = 0n;
  for (const r of rows) {
    const line = { code: r.code, nameAr: r.name_ar, amountP: r.amount };
    if (r.type === "revenue") { revenue.push(line); tr += BigInt(r.amount); }
    else { expense.push(line); te += BigInt(r.amount); }
  }
  return { revenue, expense, totalRevenueP: tr.toString(), totalExpenseP: te.toString(), netProfitP: (tr - te).toString() };
}

// ---------------------------------------------------------------
// الإيرادات حسب النوع
// ---------------------------------------------------------------

export async function revenueByType(ex: SqlExecutor): Promise<{ rows: PnlLine[]; totalP: string }> {
  const rows = rowsOf<{ code: string; name_ar: string; amount: string }>(
    await ex.execute(sql`
      SELECT a.code, MIN(a.name_ar) AS name_ar,
             COALESCE(SUM(jl.credit_p - jl.debit_p), 0)::text AS amount
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.type = 'revenue'
      GROUP BY a.code
      ORDER BY COALESCE(SUM(jl.credit_p - jl.debit_p), 0) DESC
    `)
  );
  let total = 0n;
  const out: PnlLine[] = rows.map((r) => { total += BigInt(r.amount); return { code: r.code, nameAr: r.name_ar, amountP: r.amount }; });
  return { rows: out, totalP: total.toString() };
}

// ---------------------------------------------------------------
// دفتر اليومية
// ---------------------------------------------------------------

export interface JournalRow {
  entryNo: string;
  entryDate: string;
  descriptionAr: string;
  kind: string;
  sourceType: string;
  totalP: string;
  isReversal: boolean;
}

/** آخر قيود اليومية — بإجمالي كل قيد (مجموع المدين). */
export async function journal(
  ex: SqlExecutor,
  input: { limit?: number; kind?: string | null } = {}
): Promise<JournalRow[]> {
  const limit = Math.min(input.limit ?? 50, 200);
  const rows = rowsOf<{
    entry_no: string; entry_date: string; description_ar: string;
    kind: string; source_type: string; total: string; is_reversal: boolean;
  }>(
    await ex.execute(sql`
      SELECT je.entry_no::text, je.entry_date::text, je.description_ar,
             je.kind, je.source_type, je.is_reversal,
             COALESCE((SELECT SUM(jl.debit_p) FROM journal_lines jl WHERE jl.entry_id = je.id), 0)::text AS total
      FROM journal_entries je
      WHERE 1=1 ${input.kind ? sql`AND je.kind = ${input.kind}` : sql``}
      ORDER BY je.entry_no DESC
      LIMIT ${limit}
    `)
  );
  return rows.map((r) => ({
    entryNo: r.entry_no, entryDate: r.entry_date, descriptionAr: r.description_ar,
    kind: r.kind, sourceType: r.source_type, totalP: r.total, isReversal: r.is_reversal,
  }));
}
