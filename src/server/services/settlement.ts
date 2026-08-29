/**
 * ============================================================
 *  التسويات — Settlement
 * ------------------------------------------------------------
 *  ⚠️ أخطر عملية مالية: بتحوّل فلوس التاجر. الشحنة متدخل
 *     تسوية **إلا لو الأربعة اتحققوا**:
 *      ١) مقفولة ماليًا (ليها قيد إقفال مش معكوس)
 *      ٢) is_settled = false
 *      ٣) recorded_at <= cutoff  (ساعة السيرفر مش الموبايل)
 *      ٤) الكاش وصل الشركة فعلًا (المندوب سلّم عهدته)
 *
 *  بـ FOR UPDATE SKIP LOCKED — محاسبين مع بعض مش هياخدوا
 *  نفس الشحنة. الصافي بيتحسب **من الدفتر** (حركة مستحقات
 *  التاجر لكل شحنة)، مش من رقم مخزّن ممكن يكون قديم.
 *
 *  الصافي سالب (مرتجعات أكتر من تسليمات) → بيترحّل للدورة
 *  الجاية (الشحنات بتفضل غير مسوّاة).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { Piastres } from "@/lib/money";
import { buildPayoutEntry } from "../domain/ledger";
import { postEntry, recomputeMerchantBalance, type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export interface RunSettlementInput {
  merchantId: string;
  /** ساعة الإغلاق — أي كاش اتأكد بعدها يروح للدورة الجاية */
  cutoffAt: Date;
  code: string;
  actorUserId: string | null;
}

export interface SettlementSummary {
  settlementId: string;
  code: string;
  itemCount: number;
  netPayableP: Piastres;
  requiresTwoApprovals: boolean;
  status: string;
}

/**
 * تشغيل تسوية لتاجر: بيلمّ الشحنات المؤهّلة ويعمل تسوية مسودة.
 */
export async function runSettlement(
  ex: SqlExecutor,
  input: RunSettlementInput
): Promise<SettlementSummary> {
  const cutoff = input.cutoffAt.toISOString();

  // الشحنات المؤهّلة — بقفل FOR UPDATE SKIP LOCKED على الشحنة
  const eligible = rowsOf<{
    id: string;
    cod_collected_p: string | null;
    total_fees_p: string;
    net_p: string;
    created_at: string;
  }>(
    await ex.execute(sql`
      WITH closing AS (
        SELECT je.source_id AS shipment_id, je.entry_date, je.kind
        FROM journal_entries je
        WHERE je.source_type = 'shipment'
          AND je.kind IN ('delivery','partial_delivery','return','cancellation')
          AND je.is_reversal = false
          AND NOT EXISTS (
            SELECT 1 FROM journal_entries r
            WHERE r.source_type = je.source_type AND r.source_id = je.source_id
              AND r.kind = je.kind || '_reversal' AND r.is_reversal = true
          )
      ),
      last_handover AS (
        SELECT a.owner_id AS courier_id, MAX(je.entry_date) AS confirmed_until
        FROM journal_entries je
        JOIN journal_lines jl ON jl.entry_id = je.id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.kind = 'handover' AND a.code = 'COURIER_CASH'
        GROUP BY a.owner_id
      ),
      payable AS (
        SELECT jl.shipment_id, SUM(jl.credit_p - jl.debit_p) AS net_p
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE a.code = 'MERCHANT_PAYABLE' AND a.owner_id = ${input.merchantId}::uuid
        GROUP BY jl.shipment_id
      )
      SELECT s.id, s.cod_collected_p::text, s.total_fees_p::text,
             COALESCE(p.net_p, 0)::text AS net_p, s.created_at::text
      FROM shipments s
      JOIN closing c ON c.shipment_id = s.id
      LEFT JOIN payable p ON p.shipment_id = s.id
      LEFT JOIN last_handover lh ON lh.courier_id = s.current_courier_id
      WHERE s.merchant_id = ${input.merchantId}::uuid
        AND s.is_settled = false
        AND c.entry_date <= ${cutoff}
        AND (
          -- مفيش كاش في عهدة مندوب: محفظة/إنستاباي/مقدم/مرتجع
          s.cod_method IS DISTINCT FROM 'cash'
          OR c.kind IN ('return','cancellation')
          -- كاش: بس لو المندوب سلّم عهدته اللي بتغطّي التسليم ده
          OR (lh.confirmed_until IS NOT NULL AND c.entry_date <= lh.confirmed_until)
        )
      ORDER BY s.created_at ASC
      FOR UPDATE OF s SKIP LOCKED
    `)
  );

  if (eligible.length === 0) {
    throw new HttpError(422, "NOTHING_ELIGIBLE", "مفيش شحنات مؤهّلة للتسوية دلوقتي");
  }

  let net = 0n;
  let gross = 0n;
  let fees = 0n;
  for (const e of eligible) {
    net += BigInt(e.net_p);
    gross += BigInt(e.cod_collected_p ?? "0");
    fees += BigInt(e.total_fees_p);
  }

  // ⚠️ صافي سالب → ترحيل. الشحنات بتفضل غير مسوّاة عشان
  //    المرتجعات تتقاص مع تسليمات الدورة الجاية.
  if (net <= 0n) {
    throw new HttpError(
      422,
      "NET_NEGATIVE",
      "صافي المستحقات سالب أو صفر (مرتجعات أكتر من تسليمات) — هيترحّل للدورة الجاية"
    );
  }

  const threshold = await moneySetting(ex, "settlement.two_person_approval_threshold_p", 2000000n);
  const requiresTwo = net > threshold;
  // أقدم شحنة في الدفعة = بداية الفترة (للعرض)
  const periodFrom = eligible.reduce(
    (min, e) => (e.created_at < min ? e.created_at : min),
    eligible[0]!.created_at
  );

  const settlement = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO settlements
        (code, merchant_id, period_from, period_to, cutoff_at, status,
         gross_cod_p, total_fees_p, net_payable_p, requires_two_approvals, created_by)
      VALUES (
        ${input.code}, ${input.merchantId}::uuid,
        ${periodFrom}, ${cutoff}, ${cutoff}, 'draft',
        ${gross.toString()}::bigint, ${fees.toString()}::bigint, ${net.toString()}::bigint,
        ${requiresTwo}, ${input.actorUserId ?? null}::uuid
      )
      RETURNING id
    `)
  )[0]!;

  // البنود + قفل الشحنات (is_settled بيتعمل عند الدفع مش دلوقتي —
  // عشان لو التسوية اتلغت الشحنات ترجع للـ pool)
  for (const e of eligible) {
    await ex.execute(sql`
      INSERT INTO settlement_items (settlement_id, shipment_id, cod_collected_p, fees_p, net_p)
      VALUES (${settlement.id}::uuid, ${e.id}::uuid,
              ${(e.cod_collected_p ?? "0")}::bigint, ${e.total_fees_p}::bigint, ${e.net_p}::bigint)
    `);
    // نربط الشحنة بالتسوية بس من غير ما نعلّمها مدفوعة
    await ex.execute(sql`
      UPDATE shipments SET settlement_id = ${settlement.id}::uuid WHERE id = ${e.id}::uuid
    `);
  }

  return {
    settlementId: settlement.id,
    code: input.code,
    itemCount: eligible.length,
    netPayableP: net,
    requiresTwoApprovals: requiresTwo,
    status: "draft",
  };
}

/**
 * اعتماد التسوية. فوق الحد بيحتاج شخصين مختلفين.
 */
export async function approveSettlement(
  ex: SqlExecutor,
  input: { settlementId: string; actorUserId: string }
): Promise<{ status: string; approvals: number; requiresTwo: boolean }> {
  const s = rowsOf<{
    status: string;
    requires_two_approvals: boolean;
    approved_by: string | null;
    second_approved_by: string | null;
  }>(
    await ex.execute(sql`
      SELECT status, requires_two_approvals, approved_by::text, second_approved_by::text
      FROM settlements WHERE id = ${input.settlementId}::uuid FOR UPDATE
    `)
  )[0];
  if (!s) throw new HttpError(404, "NOT_FOUND", "التسوية مش موجودة");
  if (s.status === "paid") throw new HttpError(422, "ALREADY_PAID", "التسوية مدفوعة بالفعل");
  if (s.status === "cancelled") throw new HttpError(422, "CANCELLED", "التسوية ملغاة");

  if (!s.approved_by) {
    await ex.execute(sql`
      UPDATE settlements SET approved_by = ${input.actorUserId}::uuid, approved_at = now(),
        status = ${s.requires_two_approvals ? "draft" : "approved"}
      WHERE id = ${input.settlementId}::uuid
    `);
    return { status: s.requires_two_approvals ? "draft" : "approved", approvals: 1, requiresTwo: s.requires_two_approvals };
  }

  // اعتماد تاني — لازم شخص مختلف
  if (s.approved_by === input.actorUserId) {
    throw new HttpError(422, "SAME_APPROVER", "الاعتماد التاني لازم من شخص مختلف");
  }
  if (s.second_approved_by) throw new HttpError(422, "ALREADY_APPROVED", "التسوية معتمدة بالفعل");

  await ex.execute(sql`
    UPDATE settlements SET second_approved_by = ${input.actorUserId}::uuid,
      second_approved_at = now(), status = 'approved'
    WHERE id = ${input.settlementId}::uuid
  `);
  return { status: "approved", approvals: 2, requiresTwo: true };
}

/**
 * دفع التسوية: بيكتب قيد التحويل، ويعلّم الشحنات مسوّاة.
 * ⚠️ لازم تكون معتمدة (والشخصين لو فوق الحد).
 */
export async function paySettlement(
  ex: SqlExecutor,
  input: {
    settlementId: string;
    actorUserId: string | null;
    method: string;
    reference?: string | null;
    cashFeeP?: Piastres;
    expediteFeeP?: Piastres;
    branchId?: string | null;
  }
): Promise<{ status: string; journalEntryNo: bigint }> {
  const s = rowsOf<{
    code: string;
    merchant_id: string;
    status: string;
    net_payable_p: string;
    requires_two_approvals: boolean;
    approved_by: string | null;
    second_approved_by: string | null;
  }>(
    await ex.execute(sql`
      SELECT code, merchant_id::text, status, net_payable_p::text, requires_two_approvals,
             approved_by::text, second_approved_by::text
      FROM settlements WHERE id = ${input.settlementId}::uuid FOR UPDATE
    `)
  )[0];
  if (!s) throw new HttpError(404, "NOT_FOUND", "التسوية مش موجودة");
  if (s.status === "paid") throw new HttpError(422, "ALREADY_PAID", "التسوية مدفوعة بالفعل");
  if (!s.approved_by) throw new HttpError(422, "NOT_APPROVED", "التسوية لازم تتعتمد الأول");
  if (s.requires_two_approvals && !s.second_approved_by) {
    throw new HttpError(422, "NEEDS_SECOND_APPROVAL", "التسوية دي فوق الحد — محتاجة اعتماد شخص تاني");
  }

  const net = BigInt(s.net_payable_p);
  const entry = buildPayoutEntry({
    settlementId: input.settlementId,
    merchantId: s.merchant_id,
    code: s.code,
    netPayableP: net,
    method: input.method,
    cashFeeP: input.cashFeeP,
    expediteFeeP: input.expediteFeeP,
    branchId: input.branchId ?? undefined,
  });
  const posted = await postEntry(ex, entry, { actorUserId: input.actorUserId });

  await ex.execute(sql`
    UPDATE settlements SET status = 'paid', paid_by = ${input.actorUserId ?? null}::uuid,
      paid_at = now(), payout_reference = ${input.reference ?? null},
      journal_entry_id = ${posted.entryId}::uuid, payout_method_id = NULL
    WHERE id = ${input.settlementId}::uuid
  `);

  // الشحنات بقت مسوّاة — متدخلش تسوية تانية أبدًا
  await ex.execute(sql`
    UPDATE shipments SET is_settled = true
    WHERE settlement_id = ${input.settlementId}::uuid
  `);

  // تحديث رصيد التاجر المعروض
  await recomputeMerchantBalance(ex, s.merchant_id);

  return { status: "paid", journalEntryNo: posted.entryNo };
}

async function moneySetting(ex: SqlExecutor, key: string, fallback: bigint): Promise<bigint> {
  const rows = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1`)
  );
  const v = rows[0]?.value;
  if (v === undefined || v === null) return fallback;
  try {
    return BigInt(typeof v === "number" ? Math.round(v) : String(v));
  } catch {
    return fallback;
  }
}
