/**
 * /api/v1/merchants/:id
 *  GET    → جاهزية الحذف (الأرصدة + الشحنات الشغّالة).
 *  DELETE → يحذف التاجر بعد التأكد إن مفيش فلوس ليه ولا علينا.
 *
 * ⚠️ حماية مالية: مينفعش حذف لو عليه/له فلوس أو عنده شحنات شغّالة.
 *   • تاجر من غير أي تاريخ → حذف نهائي.
 *   • تاجر عنده تاريخ (رصيد صفر) → أرشفة (is_active=false) عشان
 *     سجل الفلوس والشحنات القديمة يفضل سليم — الدفتر مبيتمسحش أبدًا.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError, notFound } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MANAGER = ["super_admin", "branch_manager"] as const;
const TERMINAL = "('delivered','partially_delivered','returned_to_merchant','cancelled','lost','damaged','disposed')";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

async function assess(merchantId: string) {
  const [m] = rowsOf<{ name_ar: string }>(
    await db.execute(sql`SELECT name_ar FROM merchants WHERE id = ${merchantId}::uuid`)
  );
  if (!m) return null;
  const [bal] = rowsOf<{ payable: string; wallet: string }>(
    await db.execute(sql`
      SELECT
        COALESCE(SUM(jl.credit_p - jl.debit_p) FILTER (WHERE a.code='MERCHANT_PAYABLE'),0)::text AS payable,
        COALESCE(SUM(jl.credit_p - jl.debit_p) FILTER (WHERE a.code='MERCHANT_WALLET'),0)::text AS wallet
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.owner_id = ${merchantId}::uuid
    `)
  );
  const [cnt] = rowsOf<{ total: string; active: string; ledger: string }>(
    await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM shipments WHERE merchant_id = ${merchantId}::uuid)::text AS total,
        (SELECT COUNT(*) FROM shipments WHERE merchant_id = ${merchantId}::uuid
           AND status NOT IN ${sql.raw(TERMINAL)})::text AS active,
        (SELECT COUNT(*) FROM journal_lines WHERE merchant_id = ${merchantId}::uuid)::text AS ledger
    `)
  );
  const payableP = BigInt(bal?.payable ?? "0");
  const walletP = BigInt(bal?.wallet ?? "0");
  const active = Number(cnt?.active ?? 0);
  const total = Number(cnt?.total ?? 0);
  const hasLedger = Number(cnt?.ledger ?? 0) > 0;

  const blockers: string[] = [];
  if (payableP > 0n) blockers.push(`مستحق للتاجر ${formatEGP(payableP)} — لازم تسوية/تحويل الأول`);
  if (payableP < 0n) blockers.push(`على التاجر ${formatEGP(-payableP)} — لازم تحصيله الأول`);
  if (walletP !== 0n) blockers.push(`لسه في محفظته ${formatEGP(walletP)}`);
  if (active > 0) blockers.push(`عنده ${active} شحنة شغّالة (مش نهائية)`);

  const canDelete = blockers.length === 0;
  const mode = !canDelete ? "blocked" : total === 0 && !hasLedger ? "hard" : "soft";
  return {
    name: m.name_ar,
    payable: formatEGP(payableP), payableP: payableP.toString(),
    wallet: formatEGP(walletP),
    activeShipments: active, totalShipments: total,
    canDelete, mode, blockers,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, MANAGER);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const a = await assess(id);
    if (!a) return handleError(notFound("التاجر مش موجود"));
    return ok(a);
  } catch (err) { return handleError(err); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, MANAGER);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const a = await assess(id);
    if (!a) return handleError(notFound("التاجر مش موجود"));
    if (!a.canDelete) return fail("HAS_BALANCE", a.blockers.join(" · "), 422);

    await db.transaction(async (tx) => {
      if (a.mode === "hard") {
        // تاجر من غير أي تاريخ — حذف نهائي (هو + حسابه + أي حسابات دفتر فاضية)
        await tx.execute(sql`DELETE FROM users WHERE merchant_id = ${id}::uuid`);
        await tx.execute(sql`DELETE FROM accounts WHERE owner_id = ${id}::uuid`);
        await tx.execute(sql`DELETE FROM merchants WHERE id = ${id}::uuid`);
      } else {
        // عنده تاريخ — أرشفة: نوقفه ونوقف دخوله (سجل الفلوس بيفضل)
        await tx.execute(sql`UPDATE merchants SET is_active = false, updated_at = now() WHERE id = ${id}::uuid`);
        await tx.execute(sql`UPDATE users SET is_active = false WHERE merchant_id = ${id}::uuid`);
      }
    });
    return ok({ deleted: a.mode });
  } catch (err) { return handleError(err); }
}
