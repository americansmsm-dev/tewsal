/**
 * DELETE /api/v1/blacklist/:phone — شيل رقم من القائمة السوداء.
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { removeBlacklist } from "@/server/services/crm";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops", "support"] as const;

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  try {
    await requireRole(req, OPS);
    const { phone } = await params;
    const result = await db.transaction((tx) => removeBlacklist(tx, decodeURIComponent(phone)));
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
