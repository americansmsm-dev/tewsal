/**
 * ============================================================
 *  تسليم العهدة النقدية — Cash Handover
 * ------------------------------------------------------------
 *  المندوب بيسلّم كاشه للخزنة. المتوقع = رصيد «كاش المندوب»
 *  من الدفتر (مش رقم مدخول). الكاشير بيعدّ ويأكّد المبلغ.
 *
 *  ⚠️ العجز → ذمة على المندوب · الزيادة → التزام معلّق
 *     (مش إيراد). القيد بيتكتب من buildHandoverEntry جوه
 *     نفس الترانزاكشن، وبيحدّث أرصدة التجار المتأثرين.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { Piastres } from "@/lib/money";
import { buildHandoverEntry, ACC } from "../domain/ledger";
import { postEntry, accountBalance, recomputeMerchantBalance, type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export interface HandoverInput {
  courierId: string;
  branchId: string;
  /** اللي اتعدّ فعلًا (قروش) */
  receivedP: Piastres;
  code: string;
  actorUserId: string | null;
  varianceNote?: string | null;
}

export interface HandoverResult {
  handoverId: string;
  code: string;
  expectedP: Piastres;
  receivedP: Piastres;
  varianceP: Piastres;
  journalEntryNo: bigint;
}

export async function recordHandover(
  ex: SqlExecutor,
  input: HandoverInput
): Promise<HandoverResult> {
  // المتوقع = رصيد كاش المندوب من الدفتر
  const expectedP = await accountBalance(ex, ACC.courierCash(input.courierId));
  if (expectedP <= 0n) {
    throw new HttpError(422, "NO_CASH", "المندوب ده مالوش كاش في العهدة دلوقتي");
  }
  const variance = input.receivedP - expectedP;

  // ⚠️ العجز لازم يبقى معاه سبب مكتوب
  if (variance < 0n && !input.varianceNote?.trim()) {
    throw new HttpError(422, "SHORTAGE_NEEDS_NOTE", "العجز محتاج سبب مكتوب");
  }

  const merchantsBefore = await merchantsWithCourierCash(ex, input.courierId);

  const entry = buildHandoverEntry({
    handoverId: crypto.randomUUID(), // مؤقت — بيتحط الحقيقي تحت
    courierId: input.courierId,
    branchId: input.branchId,
    expectedP,
    receivedP: input.receivedP,
  });

  // سطر جدول العهدة
  const ho = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO cash_handovers
        (code, from_type, from_id, to_type, to_id, expected_p, amount_p, variance_p,
         method, status, variance_note, created_by, confirmed_by, confirmed_at)
      VALUES (
        ${input.code}, 'courier', ${input.courierId}::uuid, 'branch', ${input.branchId}::uuid,
        ${expectedP.toString()}::bigint, ${input.receivedP.toString()}::bigint, ${variance.toString()}::bigint,
        'cash', 'confirmed', ${input.varianceNote ?? null},
        ${input.actorUserId ?? null}::uuid, ${input.actorUserId ?? null}::uuid, now()
      )
      RETURNING id
    `)
  )[0]!;

  // القيد المحاسبي — بمصدر العهدة الحقيقي
  const posted = await postEntry(
    ex,
    { ...entry, sourceId: ho.id },
    { actorUserId: input.actorUserId }
  );
  await ex.execute(sql`
    UPDATE cash_handovers SET journal_entry_id = ${posted.entryId}::uuid WHERE id = ${ho.id}::uuid
  `);

  // ⚠️ تسليم العهدة بيأكّد كاش المناديب → لازم نعيد حساب أرصدة
  //    التجار المتأثرين (اللي كانت شحناتهم تحت التحصيل عند ده)
  for (const merchantId of merchantsBefore) {
    await recomputeMerchantBalance(ex, merchantId);
  }

  return {
    handoverId: ho.id,
    code: input.code,
    expectedP,
    receivedP: input.receivedP,
    varianceP: variance,
    journalEntryNo: posted.entryNo,
  };
}

/** التجار اللي عندهم كاش لسه في عهدة المندوب ده */
async function merchantsWithCourierCash(ex: SqlExecutor, courierId: string): Promise<string[]> {
  const rows = rowsOf<{ merchant_id: string }>(
    await ex.execute(sql`
      SELECT DISTINCT mp.owner_id AS merchant_id
      FROM journal_entries je
      JOIN journal_lines cash ON cash.entry_id = je.id
      JOIN accounts ca ON ca.id = cash.account_id AND ca.code = 'COURIER_CASH' AND ca.owner_id = ${courierId}::uuid
      JOIN journal_lines ml ON ml.entry_id = je.id
      JOIN accounts mp ON mp.id = ml.account_id AND mp.code = 'MERCHANT_PAYABLE'
      WHERE cash.debit_p > 0
    `)
  );
  return rows.map((r) => r.merchant_id);
}

/** أرصدة كاش المناديب — للوحة الخزينة */
export async function courierCashBalances(
  ex: SqlExecutor
): Promise<Array<{ courierId: string; name: string; balanceP: string; oldest: string | null }>> {
  return rowsOf(
    await ex.execute(sql`
      SELECT a.owner_id::text AS "courierId",
             u.full_name AS name,
             (SUM(jl.debit_p) - SUM(jl.credit_p))::text AS "balanceP",
             MIN(je.entry_date)::text AS oldest
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id AND a.code = 'COURIER_CASH'
      JOIN journal_entries je ON je.id = jl.entry_id
      LEFT JOIN users u ON u.id = a.owner_id
      GROUP BY a.owner_id, u.full_name
      HAVING SUM(jl.debit_p) - SUM(jl.credit_p) > 0
      ORDER BY MIN(je.entry_date) ASC
    `)
  );
}
