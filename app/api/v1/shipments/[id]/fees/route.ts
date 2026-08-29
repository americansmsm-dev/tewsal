/**
 * /api/v1/shipments/:id/fees — الرسوم اليدوية على الشحنة
 * GET:  رسوم الشحنة (فعّالة + ملغاة)
 * POST: إضافة رسم يدوي (تغليف إضافي، تأمين قابل للكسر...) قبل التسليم
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { poundsToPiastres, formatEGP } from "@/lib/money";
import { addManualFee, listShipmentFees } from "@/server/services/shipmentFee";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS_FINANCE = ["super_admin", "branch_manager", "ops", "accountant"] as const;

const addSchema = z.object({
  feeCode: z.string().min(1).max(40),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "مبلغ غير صالح"),
  note: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, OPS_FINANCE);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const rows = await listShipmentFees(db, id);
    const fees = rows.map((f) => ({ ...f, amount: formatEGP(BigInt((f.amount_p as string) || "0")) }));
    return ok({ fees, count: fees.length });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, OPS_FINANCE);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = addSchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction((tx) =>
      addManualFee(tx, {
        shipmentId: id,
        feeCode: parsed.data.feeCode,
        amountP: poundsToPiastres(parsed.data.amount),
        note: parsed.data.note ?? null,
        actorUserId: ctx.user.userId,
      })
    );
    return ok({ feeId: result.feeId, feeCode: result.feeCode, amount: formatEGP(result.amountP) }, 201);
  } catch (err) {
    return handleError(err);
  }
}
