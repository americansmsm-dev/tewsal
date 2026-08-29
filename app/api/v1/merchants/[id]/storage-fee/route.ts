/** POST /api/v1/merchants/:id/storage-fee — رسم تخزين على التاجر (إيراد). مالية. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { chargeStorageFee } from "@/server/services/fulfillment";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

const schema = z.object({ amount: z.string().regex(/^\d+(\.\d{1,2})?$/), note: z.string().max(200).nullable().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => chargeStorageFee(tx, { merchantId: id, ...parsed.data, actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName } }));
    return ok({ amount: formatEGP(result.amountP) }, 201);
  } catch (err) { return handleError(err); }
}
