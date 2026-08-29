/**
 * ============================================================
 *  خدمة الإيداع البنكي — Bank Deposit
 * ------------------------------------------------------------
 *  خزنة الفرع بتودّع كاشها في البنك:
 *    مدين الحساب البنكي / دائن خزنة الفرع (buildBankDepositEntry)
 *  بيتسجّل في cash_handovers (from=branch → to=bank).
 *
 *  ⚠️ ممنوع تودّع أكتر من رصيد الخزنة الفعلي (من الدفتر).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { Piastres } from "@/lib/money";
import { buildBankDepositEntry, ACC } from "../domain/ledger";
import { postEntry, accountBalance, type SqlExecutor } from "./ledger";
import { type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export interface BankDepositResult {
  depositId: string;
  code: string;
  amountP: Piastres;
  branchBalanceAfterP: Piastres;
}

export async function recordBankDeposit(
  ex: SqlExecutor,
  input: {
    branchId: string;
    amountP: Piastres;
    code: string;
    bankAccount?: string;
    receiptNo?: string | null;
    actor: Actor;
  }
): Promise<BankDepositResult> {
  if (input.amountP <= 0n) throw new HttpError(400, "BAD_AMOUNT", "المبلغ لازم يكون أكبر من صفر");

  // رصيد خزنة الفرع من الدفتر — مصدر الحقيقة
  const branchBalance = await accountBalance(ex, ACC.branchCash(input.branchId));
  if (input.amountP > branchBalance) {
    throw new HttpError(422, "INSUFFICIENT_CASH",
      `مفيش كاش كفاية في الخزنة — الرصيد ${(Number(branchBalance) / 100).toFixed(2)} ج`);
  }

  // سطر الإيداع في cash_handovers (from branch → to bank)
  const dep = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO cash_handovers
        (code, from_type, from_id, to_type, to_id, expected_p, amount_p, variance_p,
         method, receipt_no, status, created_by, confirmed_by, confirmed_at)
      VALUES (
        ${input.code}, 'branch', ${input.branchId}::uuid, 'bank', NULL,
        ${input.amountP.toString()}::bigint, ${input.amountP.toString()}::bigint, 0,
        'bank', ${input.receiptNo ?? null}, 'confirmed',
        ${input.actor.userId ?? null}::uuid, ${input.actor.userId ?? null}::uuid, now()
      )
      RETURNING id
    `)
  )[0]!;

  const posted = await postEntry(
    ex,
    buildBankDepositEntry({
      handoverId: dep.id,
      branchId: input.branchId,
      amountP: input.amountP,
      bankAccount: input.bankAccount,
    }),
    { actorUserId: input.actor.userId }
  );

  await ex.execute(sql`
    UPDATE cash_handovers SET journal_entry_id = ${posted.entryId}::uuid WHERE id = ${dep.id}::uuid
  `);

  return {
    depositId: dep.id,
    code: input.code,
    amountP: input.amountP,
    branchBalanceAfterP: branchBalance - input.amountP,
  };
}
