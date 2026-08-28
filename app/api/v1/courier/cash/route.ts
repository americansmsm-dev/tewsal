/** GET /api/v1/courier/cash — رصيد كاش المندوب الحالي (لنفسه). */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { accountBalance } from "@/server/services/ledger";
import { ACC } from "@/server/domain/ledger";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole(req, ["courier", "super_admin", "branch_manager", "accountant"]);
    const courierId = ctx.user.userId;
    if (!courierId) return ok({ cash: formatEGP(0n), cashP: "0" });
    const balance = await accountBalance(db, ACC.courierCash(courierId));
    return ok({ cash: formatEGP(balance), cashP: balance.toString() });
  } catch (err) {
    return handleError(err);
  }
}
