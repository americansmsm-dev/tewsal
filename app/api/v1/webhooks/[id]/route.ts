/** DELETE /api/v1/webhooks/:id — حذف نقطة ويب-هوك. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { deleteWebhook } from "@/server/services/apiAccess";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MGMT = ["super_admin", "branch_manager"] as const;

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, MGMT);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    return ok(await db.transaction((tx) => deleteWebhook(tx, id)));
  } catch (err) { return handleError(err); }
}
