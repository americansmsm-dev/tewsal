/** POST /api/v1/run-sheets/:id/dispatch — تنزيل الكشف: شحنات المخزن تخرج للتسليم. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { dispatchRunSheet } from "@/server/services/runSheet";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

const schema = z.object({ shipmentIds: z.array(z.string().uuid()).min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, OPS);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", "اختار شحنة واحدة على الأقل", 400);

    const result = await db.transaction((tx) =>
      dispatchRunSheet(tx, {
        runSheetId: id,
        shipmentIds: parsed.data.shipmentIds,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      })
    );
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
