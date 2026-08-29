/** /api/v1/security/emergency — وضع الطوارئ (تجميد التسويات). GET · POST {on}. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { setEmergencyFreeze, emergencyState } from "@/server/services/security";
import { requireUser, requirePermission } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try { await requireUser(req); return ok({ frozen: await emergencyState(db) }); }
  catch (err) { return handleError(err); }
}

const schema = z.object({ on: z.boolean() });

export async function POST(req: NextRequest) {
  try {
    await requirePermission(req, "emergency.toggle");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "بيانات ناقصة", 400);
    return ok(await db.transaction((tx) => setEmergencyFreeze(tx, parsed.data.on)));
  } catch (err) { return handleError(err); }
}
