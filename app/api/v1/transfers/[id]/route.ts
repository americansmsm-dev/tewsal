/**
 * POST /api/v1/transfers/:id — { action: 'add', shipmentIds } | { action: 'dispatch'|'receive'|'cancel' }
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { addToTransfer, transferAction } from "@/server/services/warehouse";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), shipmentIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ action: z.enum(["dispatch", "receive", "cancel"]) }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, OPS);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const b = parsed.data;
    let result: unknown;
    await db.transaction(async (tx) => {
      result = b.action === "add"
        ? await addToTransfer(tx, { transferId: id, shipmentIds: b.shipmentIds })
        : await transferAction(tx, { transferId: id, action: b.action });
    });
    return ok(result);
  } catch (err) { return handleError(err); }
}
