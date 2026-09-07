/**
 * GET /api/v1/reports/accounting — التقارير المحاسبية المشتقّة من الدفتر:
 * ميزان المراجعة + الأرباح والخسائر + الإيرادات حسب النوع. مالية.
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { trialBalance, profitAndLoss, revenueByType } from "@/server/services/accounting";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE);
    // الأرباح والإيرادات تقارير **فترة** (افتراضي ٩٠ يوم).
    // ميزان المراجعة تراكمي بطبيعته — بيفضل من غير فترة.
    const p = new URL(req.url).searchParams;
    const win = { from: p.get("from"), to: p.get("to"), days: p.get("days") };
    const [trial, pnl, revenue] = await Promise.all([
      trialBalance(db),
      profitAndLoss(db, win),
      revenueByType(db, win),
    ]);
    return ok({ trial, pnl, revenue, period: pnl.period });
  } catch (err) {
    return handleError(err);
  }
}
