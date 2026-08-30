/** /api/v1/settings/work-hours — ساعات عمل المناديب. GET (الكل) · PATCH (المدير). */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { getWorkHours, setWorkHours } from "@/server/services/field";
import { requireUser, requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MANAGER = ["super_admin", "branch_manager"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return ok(await getWorkHours(db));
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  start: z.string().nullable().optional(),
  end: z.string().nullable().optional(),
  autoCheckout: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireRole(req, MANAGER);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "بيانات غير صالحة", 400);
    const result = await db.transaction((tx) => setWorkHours(tx, parsed.data));
    return ok(result);
  } catch (err) { return handleError(err); }
}
