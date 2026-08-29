/**
 * /api/v1/bank-deposits — الإيداع البنكي من خزنة الفرع
 * POST: تسجيل إيداع (مدين البنك / دائن الخزنة)
 * GET:  آخر الإيداعات
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { poundsToPiastres, formatEGP } from "@/lib/money";
import { recordBankDeposit } from "@/server/services/bankDeposit";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

const schema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "مبلغ غير صالح"),
  branchId: z.string().uuid().optional(),
  bankAccount: z.string().max(30).optional(),
  receiptNo: z.string().max(60).nullable().optional(),
});

function depositCode(seq: string): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `BD-${year}-${seq.padStart(6, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction(async (tx) => {
      // الفرع المطلوب أو الفرع الرئيسي
      const branchId = parsed.data.branchId
        ?? rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM branches WHERE code = 'MAIN' LIMIT 1`))[0]?.id;
      if (!branchId) throw new Error("مفيش فرع");

      const seqR = await tx.execute(sql`SELECT nextval('awb_sequence')::text AS n`);
      const n = (Array.isArray(seqR) ? seqR : (seqR as { rows: { n: string }[] }).rows)[0] as { n: string };

      return recordBankDeposit(tx, {
        branchId,
        amountP: poundsToPiastres(parsed.data.amount),
        code: depositCode(n.n),
        bankAccount: parsed.data.bankAccount,
        receiptNo: parsed.data.receiptNo,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      });
    });

    return ok({
      depositId: result.depositId,
      code: result.code,
      amount: formatEGP(result.amountP),
      branchBalanceAfter: formatEGP(result.branchBalanceAfterP),
    }, 201);
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE);
    const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 30), 200);
    const list = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT h.code, h.amount_p::text AS amount_p, h.receipt_no, h.confirmed_at, u.full_name AS by_name
        FROM cash_handovers h
        LEFT JOIN users u ON u.id = h.confirmed_by
        WHERE h.from_type = 'branch' AND h.to_type = 'bank'
        ORDER BY h.confirmed_at DESC NULLS LAST LIMIT ${limit}
      `)
    );
    const deposits = list.map((d) => ({ ...d, amount: formatEGP(BigInt((d.amount_p as string) || "0")) }));
    return ok({ deposits, count: deposits.length });
  } catch (err) {
    return handleError(err);
  }
}
