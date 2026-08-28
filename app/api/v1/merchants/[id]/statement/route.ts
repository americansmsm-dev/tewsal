/**
 * ============================================================
 *  GET /api/v1/merchants/:id/statement — كشف حساب التاجر
 * ------------------------------------------------------------
 *  ⚠️ بخانتين — ده اللي بيمنع «الرقم بيقل قدام التاجر»:
 *   ✅ مؤكد وجاهز للتحويل — الكاش وصل الشركة فعلًا
 *   ⏳ تحت التحصيل — اتسلّم بس الكاش لسه مع المندوب
 *  الرقم المؤكد عمره ما يقل.
 * ============================================================
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { recomputeMerchantBalance } from "@/server/services/ledger";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError, notFound } from "@/server/http/respond";

export const dynamic = "force-dynamic";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireUser(req);
    const { id: merchantId } = await params;
    if (!z.string().uuid().safeParse(merchantId).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    // التاجر يشوف كشفه هو بس؛ الموظفين يشوفوا الكل
    if (ctx.user.role === "merchant" && ctx.user.merchantId !== merchantId) {
      return handleError(notFound("الكشف مش متاح"));
    }

    // ⚠️ الأرصدة بتتحسب من الدفتر (مصدر الحقيقة)، مش من الكاش
    const balance = await db.transaction((tx) => recomputeMerchantBalance(tx, merchantId));

    // آخر الحركات — الشحنات المقفولة ماليًا وأثرها على المستحقات
    const lines = rowsOf<{
      awb: string;
      status: string;
      kind: string;
      net_p: string;
      recorded_at: string;
      is_settled: boolean;
    }>(
      await db.execute(sql`
        SELECT s.awb, s.status, je.kind,
               (SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text
                  FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
                  WHERE a.code = 'MERCHANT_PAYABLE' AND a.owner_id = ${merchantId}::uuid
                    AND jl.shipment_id = s.id) AS net_p,
               je.entry_date::text AS recorded_at,
               s.is_settled
        FROM shipments s
        JOIN journal_entries je ON je.source_type = 'shipment' AND je.source_id = s.id
             AND je.kind IN ('delivery','partial_delivery','return','cancellation') AND je.is_reversal = false
        WHERE s.merchant_id = ${merchantId}::uuid
        ORDER BY je.entry_date DESC
        LIMIT 100
      `)
    );

    return ok({
      merchantId,
      // الخانتين
      confirmed: formatEGP(balance.confirmedP),
      inCollection: formatEGP(balance.inCollectionP),
      confirmedP: balance.confirmedP.toString(),
      inCollectionP: balance.inCollectionP.toString(),
      totalP: (balance.confirmedP + balance.inCollectionP).toString(),
      lines: lines.map((l) => ({
        awb: l.awb,
        status: l.status,
        kind: l.kind,
        net: formatEGP(BigInt(l.net_p)),
        recordedAt: l.recorded_at,
        settled: l.is_settled,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
