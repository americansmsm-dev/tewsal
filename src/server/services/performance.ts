/**
 * ============================================================
 *  تقارير الأداء — Performance Scorecards (قراءة فقط)
 * ------------------------------------------------------------
 *  courierScorecard     — أداء كل مندوب: التسليم، من أول مرة،
 *                         المرتجعات، الكاش في العهدة، العمولات،
 *                         الخصومات، آخر تسليم.
 *  merchantProfitability — ربحية كل تاجر: الشحنات بالنتيجة،
 *                         نسبة التسليم، الإيراد، متوسط الإيراد.
 *
 *  ⚠️ قراءة فقط من الدفتر والشحنات — مفيش كتابة.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./ledger";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** نسبة مئوية مقرّبة (0–100) من بسط ومقام */
function pct(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

// ---------------------------------------------------------------
// سكوركارد المناديب
// ---------------------------------------------------------------

export interface CourierScore {
  id: string;
  name: string;
  deliveredCount: number;
  returnedCount: number;
  /** نسبة التسليم من أول مرة (بدون محاولة فاشلة) */
  firstAttemptRate: number;
  /** نسبة المرتجعات من إجمالي اللي اتحسم (تسليم + مرتجع) */
  returnRate: number;
  /** الكاش في العهدة دلوقتي (قروش) */
  cashHeldP: string;
  /** عمولات مستحقة (قروش) */
  commissionsP: string;
  /** خصومات معلّقة (قروش) */
  deductionsP: string;
  lastDeliveryAt: string | null;
}

export async function courierScorecard(ex: SqlExecutor): Promise<CourierScore[]> {
  const rows = rowsOf<{
    id: string; name: string; delivered: number; first_attempt: number;
    returned: number; last_delivery: string | null; held: string; commission: string; deductions: string;
  }>(
    await ex.execute(sql`
      WITH ship AS (
        SELECT current_courier_id AS courier_id,
          COUNT(*) FILTER (WHERE status IN ('delivered','partially_delivered'))::int AS delivered,
          COUNT(*) FILTER (WHERE status IN ('delivered','partially_delivered') AND attempts_count = 0)::int AS first_attempt,
          COUNT(*) FILTER (WHERE status = 'returned_to_merchant')::int AS returned,
          MAX(delivered_at)::text AS last_delivery
        FROM shipments WHERE current_courier_id IS NOT NULL
        GROUP BY current_courier_id
      ),
      cash AS (
        SELECT a.owner_id AS courier_id, SUM(jl.debit_p - jl.credit_p) AS held
        FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id AND a.code = 'COURIER_CASH'
        GROUP BY a.owner_id
      ),
      comm AS (
        SELECT a.owner_id AS courier_id, SUM(jl.credit_p - jl.debit_p) AS commission
        FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id AND a.code = 'COURIER_COMMISSION_PAYABLE'
        GROUP BY a.owner_id
      ),
      ded AS (
        SELECT courier_id, SUM(amount_p) AS deductions FROM courier_deductions WHERE status = 'pending' GROUP BY courier_id
      )
      SELECT u.id::text, u.full_name AS name,
             COALESCE(s.delivered, 0) AS delivered,
             COALESCE(s.first_attempt, 0) AS first_attempt,
             COALESCE(s.returned, 0) AS returned,
             s.last_delivery,
             COALESCE(c.held, 0)::text AS held,
             COALESCE(cm.commission, 0)::text AS commission,
             COALESCE(d.deductions, 0)::text AS deductions
      FROM users u
      LEFT JOIN ship s ON s.courier_id = u.id
      LEFT JOIN cash c ON c.courier_id = u.id
      LEFT JOIN comm cm ON cm.courier_id = u.id
      LEFT JOIN ded d ON d.courier_id = u.id
      WHERE u.role = 'courier' AND u.is_active = true
      ORDER BY COALESCE(s.delivered, 0) DESC, name
    `)
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    deliveredCount: r.delivered,
    returnedCount: r.returned,
    firstAttemptRate: pct(r.first_attempt, r.delivered),
    returnRate: pct(r.returned, r.delivered + r.returned),
    cashHeldP: r.held,
    commissionsP: r.commission,
    deductionsP: r.deductions,
    lastDeliveryAt: r.last_delivery,
  }));
}

// ---------------------------------------------------------------
// ربحية التجار
// ---------------------------------------------------------------

export interface MerchantProfit {
  id: string;
  name: string;
  code: string;
  tier: string;
  shipmentsCount: number;
  deliveredCount: number;
  returnedCount: number;
  lostCount: number;
  /** نسبة التسليم من اللي اتحسم */
  deliveryRate: number;
  /** الإيراد اللي جابه التاجر (شحن + تحصيل + مرتجع + أخرى) */
  revenueP: string;
  /** متوسط الإيراد لكل شحنة مُسلَّمة */
  avgRevenuePerDeliveredP: string;
}

export async function merchantProfitability(ex: SqlExecutor): Promise<MerchantProfit[]> {
  const rows = rowsOf<{
    id: string; name: string; code: string; tier: string;
    total: number; delivered: number; returned: number; lost: number; revenue: string;
  }>(
    await ex.execute(sql`
      WITH ship AS (
        SELECT merchant_id,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status IN ('delivered','partially_delivered'))::int AS delivered,
          COUNT(*) FILTER (WHERE status = 'returned_to_merchant')::int AS returned,
          COUNT(*) FILTER (WHERE status IN ('lost','damaged','disposed'))::int AS lost
        FROM shipments GROUP BY merchant_id
      ),
      rev AS (
        SELECT s.merchant_id, SUM(jl.credit_p - jl.debit_p) AS revenue
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id AND a.type = 'revenue'
        JOIN shipments s ON s.id = jl.shipment_id
        GROUP BY s.merchant_id
      )
      SELECT m.id::text, m.name_ar AS name, m.code, m.tier,
             COALESCE(sh.total, 0) AS total,
             COALESCE(sh.delivered, 0) AS delivered,
             COALESCE(sh.returned, 0) AS returned,
             COALESCE(sh.lost, 0) AS lost,
             COALESCE(r.revenue, 0)::text AS revenue
      FROM merchants m
      LEFT JOIN ship sh ON sh.merchant_id = m.id
      LEFT JOIN rev r ON r.merchant_id = m.id
      WHERE COALESCE(sh.total, 0) > 0
      ORDER BY COALESCE(r.revenue, 0) DESC, name
    `)
  );
  return rows.map((r) => {
    const revenue = BigInt(r.revenue);
    const resolved = r.delivered + r.returned + r.lost;
    const avg = r.delivered > 0 ? revenue / BigInt(r.delivered) : 0n;
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      tier: r.tier,
      shipmentsCount: r.total,
      deliveredCount: r.delivered,
      returnedCount: r.returned,
      lostCount: r.lost,
      deliveryRate: pct(r.delivered, resolved),
      revenueP: revenue.toString(),
      avgRevenuePerDeliveredP: avg.toString(),
    };
  });
}
