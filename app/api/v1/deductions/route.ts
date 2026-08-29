/** GET /api/v1/deductions — خصومات المناديب (عجز العهد). مالية/عمليات. */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { listDeductions } from "@/server/services/deduction";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE_OPS = ["super_admin", "branch_manager", "accountant", "ops"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE_OPS);
    const status = new URL(req.url).searchParams.get("status");
    const rows = await listDeductions(db, { status });
    const deductions = rows.map((d) => ({ ...d, amount: formatEGP(BigInt((d.amount_p as string) || "0")) }));
    return ok({ deductions, count: deductions.length });
  } catch (err) {
    return handleError(err);
  }
}
