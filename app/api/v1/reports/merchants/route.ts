/**
 * GET /api/v1/reports/merchants — ربحية التجار. مالية/عمليات.
 */
import { type NextRequest } from "next/server";
// ⚠️ حوض التقارير المنفصل — عشان تقرير تقيل مايجوّعش الشغل اليومي
import { reportDb as db } from "@/server/db";
import { merchantProfitability } from "@/server/services/performance";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MGMT = ["super_admin", "branch_manager", "accountant", "ops"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, MGMT);
    // فترة إجبارية — الافتراضي ٩٠ يوم (شوف reportPeriod.ts)
    const p = new URL(req.url).searchParams;
    const { rows, period } = await merchantProfitability(db, {
      from: p.get("from"), to: p.get("to"), days: p.get("days"),
      limit: Number(p.get("limit")) || undefined,
    });
    return ok({ merchants: rows, count: rows.length, period });
  } catch (err) {
    return handleError(err);
  }
}
