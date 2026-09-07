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
    // فترة إجبارية — الافتراضي ٩٠ يوم (شوف reportPeriod.ts)
    const p = new URL(req.url).searchParams;
    const { rows, period } = await courierScorecard(db, {
      from: p.get("from"), to: p.get("to"), days: p.get("days"),
    });
    return ok({ couriers: rows, count: rows.length, period });
  } catch (err) {
    return handleError(err);
  }
}
