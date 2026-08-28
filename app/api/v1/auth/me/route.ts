/**
 * GET /api/v1/auth/me — المستخدم الحالي من الجلسة.
 * بترجّع 401 لو مفيش جلسة صالحة — الواجهة بتستخدمه للحماية.
 */
import { type NextRequest } from "next/server";
import { requireUser } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";
import { ROLE_LABELS_AR } from "@/server/db/schema/identity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    return ok({
      user: {
        id: ctx.user.userId,
        name: ctx.user.fullName,
        role: ctx.user.role,
        roleLabel: ROLE_LABELS_AR[ctx.user.role] ?? ctx.user.role,
        merchantId: ctx.user.merchantId,
        mustChangePassword: ctx.user.mustChangePassword,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
