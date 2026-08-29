/**
 * GET /api/v1/reports/journal — دفتر اليومية (آخر القيود). مالية.
 * ?kind=delivery&limit=50
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { journal } from "@/server/services/accounting";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const rows = await journal(db, { kind, limit });
    return ok({ journal: rows, count: rows.length });
  } catch (err) {
    return handleError(err);
  }
}
