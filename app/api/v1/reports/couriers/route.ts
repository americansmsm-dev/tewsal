/**
 * GET /api/v1/reports/couriers — سكوركارد أداء المناديب. مالية/عمليات.
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { courierScorecard } from "@/server/services/performance";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MGMT = ["super_admin", "branch_manager", "accountant", "ops"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, MGMT);
    const couriers = await courierScorecard(db);
    return ok({ couriers, count: couriers.length });
  } catch (err) {
    return handleError(err);
  }
}
