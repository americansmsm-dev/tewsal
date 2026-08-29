/**
 * GET /api/v1/reports/aging — تقارير الأعمار.
 * أعمار كاش المناديب + أعمار مستحقات التجار تحت التحصيل.
 * مالية فقط. الأرقام بتترجّع منسّقة (formatEGP) + خام (للفرز/الألوان).
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";
import {
  courierCashAging,
  merchantReceivablesAging,
  AGING_BUCKETS,
  type AgingReport,
} from "@/server/services/reports";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

/** تنسيق تقرير خام للعرض: كل مبلغ بيبقى نص منسّق + قروش خام */
function present(report: AgingReport) {
  return {
    rows: report.rows.map((r) => ({
      id: r.id,
      name: r.name,
      buckets: r.bucketsP.map((p) => formatEGP(BigInt(p))),
      bucketsP: r.bucketsP,
      total: formatEGP(BigInt(r.totalP)),
      totalP: r.totalP,
      oldestDays: r.oldestDays,
    })),
    totals: report.totalsP.map((p) => formatEGP(BigInt(p))),
    grandTotal: formatEGP(BigInt(report.grandTotalP)),
    grandTotalP: report.grandTotalP,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE);
    const [couriers, merchants] = await Promise.all([
      courierCashAging(db),
      merchantReceivablesAging(db),
    ]);
    return ok({
      buckets: AGING_BUCKETS.map((b) => b.label),
      courierCash: present(couriers),
      merchantReceivables: present(merchants),
    });
  } catch (err) {
    return handleError(err);
  }
}
