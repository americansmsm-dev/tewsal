/**
 * GET /api/v1/reports/ops — التقارير التشغيلية الثانوية:
 * دوران المناديب + الراسلين المتوقفين + خزائن الفروع + البيك أب الشهري.
 * مالية/عمليات.
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { courierTurnover, dormantMerchants, branchTreasury, monthlyPickups } from "@/server/services/reportsOps";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MGMT = ["super_admin", "branch_manager", "accountant", "ops"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, MGMT);
    const [turnover, dormant, treasury, pickups] = await Promise.all([
      courierTurnover(db),
      dormantMerchants(db),
      branchTreasury(db),
      monthlyPickups(db),
    ]);
    return ok({ turnover, dormant, treasury, pickups });
  } catch (err) {
    return handleError(err);
  }
}
