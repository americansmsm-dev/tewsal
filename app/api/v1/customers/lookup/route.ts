/**
 * GET /api/v1/customers/lookup?phone=01... — تاريخ العميل + القائمة السوداء.
 * عمليات/خدمة عملاء.
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { recipientLookup } from "@/server/services/crm";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops", "support", "accountant"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, OPS);
    const phone = new URL(req.url).searchParams.get("phone");
    if (!phone) return fail("BAD_REQUEST", "محتاج رقم موبايل", 400);
    return ok(await recipientLookup(db, phone));
  } catch (err) {
    return handleError(err);
  }
}
