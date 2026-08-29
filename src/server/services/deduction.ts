/**
 * ============================================================
 *  خدمة خصومات المناديب — Courier Deductions
 * ------------------------------------------------------------
 *  العجز في تسليم العهدة بيتسجّل كـ courier_deduction (متابعة)
 *  فوق قيد الذمم. الإعفاء (waive) = الشركة بتسامح المندوب:
 *    مدين فروقات نقدية (خسارة) / دائن ذمم المندوب (تصفير)
 *  القيد بيتقيّد مرة واحدة (source=manual, kind=deduction_waive).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { ACC, type DraftEntry } from "../domain/ledger";
import { postEntry, type SqlExecutor } from "./ledger";
import { type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function listDeductions(
  ex: SqlExecutor,
  opts: { status?: string | null; limit?: number } = {}
): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(opts.limit ?? 100, 200);
  return rowsOf(
    await ex.execute(sql`
      SELECT d.id, d.amount_p::text AS amount_p, d.reason_ar, d.status, d.created_at, d.recovered_at,
             u.full_name AS courier_name
      FROM courier_deductions d
      LEFT JOIN users u ON u.id = d.courier_id
      WHERE 1=1 ${opts.status ? sql`AND d.status = ${opts.status}` : sql``}
      ORDER BY (d.status = 'pending') DESC, d.created_at DESC
      LIMIT ${limit}
    `)
  );
}

/** إعفاء المندوب من الخصم — كتابة الخسارة على الشركة */
export async function waiveDeduction(
  ex: SqlExecutor,
  input: { deductionId: string; actor: Actor }
): Promise<{ status: string; amountP: string }> {
  const d = rowsOf<{ courier_id: string; amount_p: string; status: string }>(
    await ex.execute(sql`
      SELECT courier_id::text, amount_p::text, status
      FROM courier_deductions WHERE id = ${input.deductionId}::uuid FOR UPDATE
    `)
  )[0];
  if (!d) throw new HttpError(404, "NOT_FOUND", "الخصم مش موجود");
  if (d.status === "waived" || d.status === "recovered") {
    throw new HttpError(422, "ALREADY_RESOLVED", "الخصم اتحلّ بالفعل");
  }

  const amount = BigInt(d.amount_p);
  if (amount > 0n) {
    const draft: DraftEntry = {
      descriptionAr: "إعفاء عجز مندوب",
      sourceType: "manual",
      sourceId: input.deductionId,
      kind: "deduction_waive",
      lines: [
        { account: ACC.cashVariance(), debitP: amount, creditP: 0n, memo: "إعفاء عجز مندوب" },
        { account: ACC.courierReceivable(d.courier_id), debitP: 0n, creditP: amount, memo: "تصفير ذمة", courierId: d.courier_id },
      ],
    };
    await postEntry(ex, draft, { actorUserId: input.actor.userId });
  }

  await ex.execute(sql`
    UPDATE courier_deductions SET status = 'waived', waived_by = ${input.actor.userId ?? null}::uuid,
      recovered_at = now() WHERE id = ${input.deductionId}::uuid
  `);

  return { status: "waived", amountP: d.amount_p };
}
