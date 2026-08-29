/**
 * ============================================================
 *  خدمة المطالبات والتعويض — Claims
 * ------------------------------------------------------------
 *  openClaim    — بتتفتح تلقائيًا لما شحنة تبقى lost/damaged
 *                 (من الـ route بعد applyTransition، بدون قيد).
 *  resolveClaim — المالية تعتمد → يتقيّد التعويض بحد
 *                 min(المعلنة, compensation.max_p)، أو ترفض.
 *
 *  ⚠️ التعويض ممنوع لو القابل للكسر مش مؤمّن — إلا بتجاوز
 *     صريح من super_admin. القيد بيتقيّد مرة واحدة (source=claim).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { Piastres } from "@/lib/money";
import { buildCompensationEntry } from "../domain/ledger";
import { postEntry, recomputeMerchantBalance, type SqlExecutor } from "./ledger";
import { type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** حد التعويض الأقصى من الإعدادات (افتراضي ٦٠٠ ج) */
async function compensationCap(ex: SqlExecutor): Promise<Piastres> {
  const r = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = 'compensation.max_p' LIMIT 1`)
  );
  return BigInt(Number(r[0]?.value ?? 60000));
}

function minP(a: Piastres, b: Piastres): Piastres {
  return a < b ? a : b;
}

export interface OpenClaimResult {
  claimId: string;
  code: string;
  status: string;
  suggestedAmountP: Piastres;
  fragileBlocked: boolean;
  alreadyOpen: boolean;
}

/**
 * فتح مطالبة لشحنة مفقودة/تالفة. بتتنده من الـ route جوه نفس
 * ترانزاكشن التحول. آمنة للتكرار: لو المطالبة موجودة بترجّعها.
 */
export async function openClaim(
  ex: SqlExecutor,
  input: { shipmentId: string; code: string; actorUserId: string | null }
): Promise<OpenClaimResult> {
  const s = rowsOf<{
    awb: string; merchant_id: string; status: string;
    declared_value_p: string; is_fragile: boolean; fragile_insured: boolean;
  }>(
    await ex.execute(sql`
      SELECT awb, merchant_id::text, status, declared_value_p::text, is_fragile, fragile_insured
      FROM shipments WHERE id = ${input.shipmentId}::uuid
    `)
  )[0];
  if (!s) throw new HttpError(404, "NOT_FOUND", "الشحنة مش موجودة");
  if (s.status !== "lost" && s.status !== "damaged") {
    throw new HttpError(422, "NOT_CLAIMABLE", "المطالبة بتتفتح للمفقود/التالف بس");
  }

  const cap = await compensationCap(ex);
  const declared = BigInt(s.declared_value_p);
  const suggested = minP(declared, cap);
  const fragileBlocked = s.is_fragile && !s.fragile_insured;

  try {
    const claim = rowsOf<{ id: string }>(
      await ex.execute(sql`
        INSERT INTO claims
          (code, shipment_id, merchant_id, awb, type, status, declared_value_p,
           suggested_amount_p, is_fragile, fragile_insured, fragile_blocked, opened_by_user_id)
        VALUES (
          ${input.code}, ${input.shipmentId}::uuid, ${s.merchant_id}::uuid, ${s.awb},
          ${s.status}, 'open', ${declared.toString()}::bigint, ${suggested.toString()}::bigint,
          ${s.is_fragile}, ${s.fragile_insured}, ${fragileBlocked}, ${input.actorUserId ?? null}::uuid
        )
        RETURNING id
      `)
    )[0]!;
    return { claimId: claim.id, code: input.code, status: "open", suggestedAmountP: suggested, fragileBlocked, alreadyOpen: false };
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "23505") {
      // مطالبة موجودة للشحنة دي بالفعل — نرجّعها من غير ما نكسر التحول
      const existing = rowsOf<{ id: string; code: string; status: string; suggested_amount_p: string; fragile_blocked: boolean }>(
        await ex.execute(sql`SELECT id, code, status, suggested_amount_p::text, fragile_blocked FROM claims WHERE shipment_id = ${input.shipmentId}::uuid LIMIT 1`)
      )[0]!;
      return {
        claimId: existing.id, code: existing.code, status: existing.status,
        suggestedAmountP: BigInt(existing.suggested_amount_p), fragileBlocked: existing.fragile_blocked, alreadyOpen: true,
      };
    }
    throw err;
  }
}

export interface ResolveClaimResult {
  status: string;
  approvedAmountP: Piastres;
  posted: boolean;
}

/** اعتماد أو رفض مطالبة. الاعتماد بيقيّد التعويض. */
export async function resolveClaim(
  ex: SqlExecutor,
  input: {
    claimId: string;
    decision: "approve" | "reject";
    amountP?: Piastres | null;
    overrideFragile?: boolean;
    rejectReason?: string | null;
    actor: Actor;
  }
): Promise<ResolveClaimResult> {
  const c = rowsOf<{
    status: string; merchant_id: string; shipment_id: string; awb: string;
    declared_value_p: string; suggested_amount_p: string; fragile_blocked: boolean;
  }>(
    await ex.execute(sql`
      SELECT status, merchant_id::text, shipment_id::text, awb,
             declared_value_p::text, suggested_amount_p::text, fragile_blocked
      FROM claims WHERE id = ${input.claimId}::uuid FOR UPDATE
    `)
  )[0];
  if (!c) throw new HttpError(404, "NOT_FOUND", "المطالبة مش موجودة");
  if (c.status !== "open") throw new HttpError(422, "ALREADY_RESOLVED", "المطالبة اتحلّت بالفعل");

  // ─── رفض ───
  if (input.decision === "reject") {
    if (!input.rejectReason?.trim()) throw new HttpError(422, "REASON_REQUIRED", "الرفض محتاج سبب");
    await ex.execute(sql`
      UPDATE claims SET status = 'rejected', reject_reason = ${input.rejectReason},
        resolved_by_user_id = ${input.actor.userId ?? null}::uuid, resolved_at = now(), updated_at = now()
      WHERE id = ${input.claimId}::uuid
    `);
    return { status: "rejected", approvedAmountP: 0n, posted: false };
  }

  // ─── اعتماد ───
  // حظر القابل للكسر غير المؤمّن إلا بتجاوز super_admin
  if (c.fragile_blocked && !(input.overrideFragile && input.actor.role === "super_admin")) {
    throw new HttpError(422, "FRAGILE_BLOCKED", "شحنة قابلة للكسر ومش مؤمّنة — التعويض محتاج تجاوز من مدير النظام");
  }

  const cap = await compensationCap(ex);
  const declared = BigInt(c.declared_value_p);
  const ceiling = minP(declared, cap);
  // المبلغ = اللي اتحدد أو المقترح، بحد أقصى السقف
  const requested = input.amountP ?? BigInt(c.suggested_amount_p);
  if (requested < 0n) throw new HttpError(400, "BAD_AMOUNT", "مبلغ غير صالح");
  const amount = minP(requested, ceiling);

  let posted = false;
  if (amount > 0n) {
    const entry = await postEntry(
      ex,
      buildCompensationEntry({
        claimId: input.claimId,
        merchantId: c.merchant_id,
        shipmentId: c.shipment_id,
        awb: c.awb,
        amountP: amount,
      }),
      { actorUserId: input.actor.userId }
    );
    await ex.execute(sql`
      UPDATE claims SET compensation_entry_id = ${entry.entryId}::uuid WHERE id = ${input.claimId}::uuid
    `);
    await recomputeMerchantBalance(ex, c.merchant_id);
    posted = true;
  }

  await ex.execute(sql`
    UPDATE claims SET status = 'approved', approved_amount_p = ${amount.toString()}::bigint,
      resolved_by_user_id = ${input.actor.userId ?? null}::uuid, resolved_at = now(), updated_at = now()
    WHERE id = ${input.claimId}::uuid
  `);

  return { status: "approved", approvedAmountP: amount, posted };
}
