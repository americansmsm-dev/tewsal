/**
 * GET /api/v1/reports/merchants — ربحية التجار. مالية/عمليات.
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { merchantProfitability } from "@/server/services/performance";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MGMT = ["super_admin", "branch_manager", "accountant", "ops"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, MGMT);
    const merchants = await merchantProfitability(db);
    return ok({ merchants, count: merchants.length });
  } catch (err) {
    return handleError(err);
  }
}
