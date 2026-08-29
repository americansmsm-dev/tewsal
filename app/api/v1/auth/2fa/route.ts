/**
 * POST /api/v1/auth/2fa — المصادقة الثنائية للمستخدم الحالي.
 * { action: 'setup' } → { secret, uri } · { action: 'enable', code } · { action: 'disable' }
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { setupTwoFactor, enableTwoFactor, disableTwoFactor } from "@/server/services/security";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }),
  z.object({ action: z.literal("enable"), code: z.string().min(6).max(6) }),
  z.object({ action: z.literal("disable") }),
]);

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "بيانات ناقصة", 400);
    const b = parsed.data;
    const uid = ctx.user.userId;
    let result: unknown;
    await db.transaction(async (tx) => {
      if (b.action === "setup") result = await setupTwoFactor(tx, { userId: uid, username: ctx.user.fullName });
      else if (b.action === "enable") result = await enableTwoFactor(tx, { userId: uid, code: b.code });
      else result = await disableTwoFactor(tx, uid);
    });
    return ok(result);
  } catch (err) { return handleError(err); }
}
