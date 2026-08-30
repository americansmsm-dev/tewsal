/** /api/v1/merchants/:id/wallet — رصيد محفظة التاجر (GET) وشحنها (POST). */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { walletBalance, depositToWallet } from "@/server/services/wallet";
import { poundsToPiastres } from "@/lib/money";
import { requireUser, requireRole } from "@/server/http/context";
import { ok, fail, forbidden, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const CASH_ROLES = ["super_admin", "branch_manager", "accountant"] as const;
const VIEW_ROLES = ["super_admin", "branch_manager", "accountant", "ops", "support"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireUser(req);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    // التاجر يشوف محفظته بس؛ الموظفين حسب الدور
    if (ctx.user.role === "merchant") {
      if (ctx.user.merchantId !== id) throw forbidden("مش محفظتك");
    } else if (!VIEW_ROLES.includes(ctx.user.role)) {
      throw forbidden("غير مسموح");
    }
    const balance = await walletBalance(db, id);
    return ok({
      ledgerP: balance.ledgerP.toString(),
      reservedP: balance.reservedP.toString(),
      availableP: balance.availableP.toString(),
    });
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "المبلغ لازم يكون رقم"),
  method: z.enum(["cash", "bank", "instapay", "vodafone_cash"]).default("cash"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, CASH_ROLES);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const amountP = poundsToPiastres(parsed.data.amount);
    const balance = await db.transaction((tx) =>
      depositToWallet(tx, { merchantId: id, amountP, method: parsed.data.method, actorUserId: ctx.user.userId })
    );
    return ok({
      ledgerP: balance.ledgerP.toString(),
      reservedP: balance.reservedP.toString(),
      availableP: balance.availableP.toString(),
    }, 201);
  } catch (err) { return handleError(err); }
}
