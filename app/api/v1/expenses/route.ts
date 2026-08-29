/** /api/v1/expenses — المصروفات. GET (مصروفات + بنود) · POST تسجيل (بيقيّد في الدفتر). مالية. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { recordExpense, listExpenses, listExpenseCategories } from "@/server/services/opsTools";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE);
    const [expenses, categories] = await Promise.all([listExpenses(db), listExpenseCategories(db)]);
    const rows = expenses.map((e) => ({ ...e, amount: formatEGP(BigInt((e.amount_p as string) || "0")) }));
    return ok({ expenses: rows, categories, count: rows.length });
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  categoryId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "مبلغ غير صالح"),
  description: z.string().min(1).max(300),
  paidFrom: z.enum(["branch_cash", "bank"]).optional(),
  vehicleRef: z.string().max(60).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => recordExpense(tx, { ...parsed.data, actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName } }));
    return ok({ id: result.id, code: result.code, amount: formatEGP(result.amountP) }, 201);
  } catch (err) { return handleError(err); }
}
