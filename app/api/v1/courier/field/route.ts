/**
 * /api/v1/courier/field — المندوب: موقع + حضور.
 * GET: حالة الحضور · POST: { action: 'location', lat, lng } | { action: 'check_in'|'check_out' }
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { recordLocation, attendance, myAttendance } from "@/server/services/field";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const COURIER = ["courier"] as const;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole(req, COURIER);
    return ok(await myAttendance(db, ctx.user.userId));
  } catch (err) { return handleError(err); }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("location"), lat: z.number(), lng: z.number() }),
  z.object({ action: z.enum(["check_in", "check_out"]) }),
]);

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, COURIER);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "بيانات ناقصة", 400);
    const b = parsed.data;
    const uid = ctx.user.userId!;
    let result: unknown;
    await db.transaction(async (tx) => {
      result = b.action === "location" ? await recordLocation(tx, { courierId: uid, lat: b.lat, lng: b.lng }) : await attendance(tx, { courierId: uid, action: b.action });
    });
    return ok(result);
  } catch (err) { return handleError(err); }
}
