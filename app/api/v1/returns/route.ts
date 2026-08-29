/**
 * GET /api/v1/returns — سجل المرتجعات (رف + عمر + تصعيد).
 * ?filter=active|escalated|all  (الافتراضي active)
 * عمليات/مالية.
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { listReturns } from "@/server/services/returns";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS_FINANCE = ["super_admin", "branch_manager", "ops", "accountant"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, OPS_FINANCE);
    const f = new URL(req.url).searchParams.get("filter");
    const filter = f === "escalated" || f === "all" ? f : "active";
    const { rows, thresholds } = await listReturns(db, { filter });
    return ok({ returns: rows, count: rows.length, thresholds });
  } catch (err) {
    return handleError(err);
  }
}
