/**
 * ============================================================
 *  تقارير تشغيلية ثانوية — Ops Reports (قراءة فقط)
 * ------------------------------------------------------------
 *  courierTurnover  — دوران شحنات المناديب: الشحنات اللي لسه
 *                     في عهدة كل مندوب (خرجت للتسليم) وعمرها.
 *  dormantMerchants — الراسلين المتوقفين: آخر شحنة لكل تاجر
 *                     ومن قد إيه بقاله ساكت.
 *  branchTreasury   — خزائن الفروع: الكاش في الخزنة، الوارد
 *                     من المناديب، المودَع في البنك، مصاريف الأسطول.
 *  monthlyPickups   — البيك أب الشهري: عدد الاستلامات والأوردرات
 *                     والرسوم لكل شهر.
 *
 *  ⚠️ قراءة فقط — النواة ماتتلمسش.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./ledger";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

// ---------------------------------------------------------------
// دوران شحنات المناديب
// ---------------------------------------------------------------

export interface CourierTurnover {
  id: string;
  name: string;
  /** شحنات في العهدة دلوقتي (خرجت للتسليم) */
  inCustody: number;
  /** متوسط عمر الشحنة في العهدة (أيام) */
  avgAgeDays: number;
  /** أقدم شحنة في العهدة (أيام) */
  oldestDays: number;
}

/**
 * الشحنات اللي خرجت للتسليم ولسه في يد المندوب، مقسّمة بعمرها.
 * بيكشف المندوب اللي قاعد على شحنات من غير ما يقفلها.
 */
export async function courierTurnover(ex: SqlExecutor): Promise<CourierTurnover[]> {
  const rows = rowsOf<{ id: string; name: string; in_custody: number; avg_age: number; oldest: number }>(
    await ex.execute(sql`
      SELECT u.id::text, u.full_name AS name,
             COUNT(*)::int AS in_custody,
             ROUND(AVG(GREATEST(0, EXTRACT(EPOCH FROM (now() - s.status_updated_at)) / 86400)))::int AS avg_age,
             MAX(GREATEST(0, (now()::date - s.status_updated_at::date)))::int AS oldest
      FROM shipments s
      JOIN users u ON u.id = s.current_courier_id
      WHERE s.status = 'out_for_delivery'
      GROUP BY u.id, u.full_name
      ORDER BY oldest DESC, in_custody DESC
    `)
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, inCustody: r.in_custody, avgAgeDays: r.avg_age, oldestDays: r.oldest,
  }));
}

// ---------------------------------------------------------------
// الراسلين المتوقفين
// ---------------------------------------------------------------

export interface DormantMerchant {
  id: string;
  name: string;
  code: string;
  totalShipments: number;
  lastShipmentAt: string | null;
  /** أيام من آخر شحنة — أكبر = أخطر */
  daysSinceLast: number | null;
}

/**
 * التجار مرتّبين بأطول فترة سكوت. بيساعد المبيعات تتابع مين
 * وقف يبعت. dormantAfterDays = العتبة اللي بعدها بيعتبر متوقف.
 */
export async function dormantMerchants(
  ex: SqlExecutor,
  input: { dormantAfterDays?: number } = {}
): Promise<{ rows: DormantMerchant[]; dormantAfterDays: number }> {
  const threshold = input.dormantAfterDays ?? 14;
  const rows = rowsOf<{ id: string; name: string; code: string; total: number; last_at: string | null; days: number | null }>(
    await ex.execute(sql`
      SELECT m.id::text, m.name_ar AS name, m.code,
             COUNT(s.id)::int AS total,
             MAX(s.created_at)::text AS last_at,
             CASE WHEN MAX(s.created_at) IS NULL THEN NULL
                  ELSE (now()::date - MAX(s.created_at)::date) END::int AS days
      FROM merchants m
      LEFT JOIN shipments s ON s.merchant_id = m.id
      WHERE m.is_active = true
      GROUP BY m.id, m.name_ar, m.code
      HAVING COUNT(s.id) > 0
      ORDER BY days DESC NULLS LAST
    `)
  );
  return {
    rows: rows.map((r) => ({
      id: r.id, name: r.name, code: r.code, totalShipments: r.total,
      lastShipmentAt: r.last_at, daysSinceLast: r.days,
    })),
    dormantAfterDays: threshold,
  };
}

// ---------------------------------------------------------------
// خزائن الفروع
// ---------------------------------------------------------------

export interface BranchTreasury {
  id: string;
  code: string;
  name: string;
  /** الكاش في الخزنة دلوقتي (قروش) */
  cashOnHandP: string;
  /** إجمالي الوارد من المناديب (قروش) */
  handoversInP: string;
  /** إجمالي المودَع في البنك (قروش) */
  depositsOutP: string;
}

/**
 * حركة خزنة كل فرع من الدفتر: الكاش الحالي، الوارد من العهد،
 * والمودَع في البنك. + مصاريف الأسطول (على مستوى الشركة لسه).
 */
export async function branchTreasury(
  ex: SqlExecutor
): Promise<{ branches: BranchTreasury[]; fleetExpenseP: string }> {
  const rows = rowsOf<{
    id: string; code: string; name: string; on_hand: string; handovers_in: string; deposits_out: string;
  }>(
    await ex.execute(sql`
      SELECT b.id::text, b.code, b.name_ar AS name,
             COALESCE(SUM(jl.debit_p - jl.credit_p), 0)::text AS on_hand,
             COALESCE(SUM(jl.debit_p) FILTER (WHERE je.kind = 'handover'), 0)::text AS handovers_in,
             COALESCE(SUM(jl.credit_p) FILTER (WHERE je.kind = 'bank_deposit'), 0)::text AS deposits_out
      FROM branches b
      JOIN accounts a ON a.owner_id = b.id AND a.code = 'BRANCH_CASH'
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.entry_id
      GROUP BY b.id, b.code, b.name_ar
      ORDER BY b.code
    `)
  );

  const fleet = rowsOf<{ amount: string }>(
    await ex.execute(sql`
      SELECT COALESCE(SUM(jl.debit_p - jl.credit_p), 0)::text AS amount
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id AND a.code = 'FLEET_EXPENSE'
    `)
  )[0];

  return {
    branches: rows.map((r) => ({
      id: r.id, code: r.code, name: r.name,
      cashOnHandP: r.on_hand, handoversInP: r.handovers_in, depositsOutP: r.deposits_out,
    })),
    fleetExpenseP: fleet?.amount ?? "0",
  };
}

// ---------------------------------------------------------------
// البيك أب الشهري
// ---------------------------------------------------------------

export interface MonthlyPickup {
  /** YYYY-MM */
  month: string;
  pickupsCount: number;
  ordersCount: number;
  serviceFeesP: string;
}

/** الاستلامات المكتملة مجمّعة بالشهر — عدد، أوردرات، رسوم. */
export async function monthlyPickups(ex: SqlExecutor, input: { months?: number } = {}): Promise<MonthlyPickup[]> {
  const months = Math.min(input.months ?? 12, 36);
  const rows = rowsOf<{ month: string; pickups: number; orders: number; fees: string }>(
    await ex.execute(sql`
      SELECT to_char(COALESCE(p.confirmed_at, p.created_at) AT TIME ZONE 'Africa/Cairo', 'YYYY-MM') AS month,
             COUNT(*)::int AS pickups,
             COALESCE(SUM(p.orders_count), 0)::int AS orders,
             COALESCE(SUM(p.service_fee_p), 0)::text AS fees
      FROM pickups p
      WHERE p.status = 'collected'
      GROUP BY month
      ORDER BY month DESC
      LIMIT ${months}
    `)
  );
  return rows.map((r) => ({
    month: r.month, pickupsCount: r.pickups, ordersCount: r.orders, serviceFeesP: r.fees,
  }));
}
