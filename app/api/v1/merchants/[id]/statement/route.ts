/**
 * ============================================================
 *  GET /api/v1/merchants/:id/statement — كشف حساب التاجر
 * ------------------------------------------------------------
 *  ⚠️ بخانتين — ده اللي بيمنع «الرقم بيقل قدام التاجر»:
 *   ✅ مؤكد وجاهز للتحويل — الكاش وصل الشركة فعلًا
 *   ⏳ تحت التحصيل — اتسلّم بس الكاش لسه مع المندوب
 *  الرقم المؤكد عمره ما يقل.
 *
 *  الكشف بيوري لكل أوردر: المحصّل من العميل · رسوم الشحن ·
 *  رسوم أخرى · إجمالي الرسوم (إيراد الشركة) · صافي التاجر ·
 *  عمولة المندوب (تكلفة) · مكسب الشركة على الأوردر.
 *
 *  🔒 الخصوصية: مكسب الشركة وعمولة المندوب **للموظفين المالية بس**
 *     (super_admin / branch_manager / accountant). التاجر بيشوف
 *     كشفه ورسومه وصافيه بس — مش مكسب الشركة ولا تكلفة المندوب.
 *
 *  الأرقام كلها من الدفتر المزدوج (journal_lines) — قراءة فقط،
 *  مفيش أي كتابة قيود هنا. النواة ماتتلمسش.
 * ============================================================
 */
import { type NextRequest } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { recomputeMerchantBalance } from "@/server/services/ledger";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError, notFound } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const FINANCE_ROLES = ["super_admin", "branch_manager", "accountant"];

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

function validDate(v: string | null): string | null {
  return v && !Number.isNaN(Date.parse(v)) ? v : null;
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

    // 🔒 مكسب الشركة وتكلفة المندوب للمالية بس
    const canSeeProfit = FINANCE_ROLES.includes(ctx.user.role);

    // فلتر الفترة (اختياري) — بيتطبّق على تاريخ القيد
    const url = new URL(req.url);
    const from = validDate(url.searchParams.get("from"));
    const to = validDate(url.searchParams.get("to"));
    // نافذة زمنية على alias القيد je (بتتحط جوّه الاستعلامات اللي فيها je)
    const win: SQL = sql`${from ? sql`AND je.entry_date >= ${from}::timestamptz` : sql``}${
      to ? sql`AND je.entry_date <= ${to}::timestamptz` : sql``
    }`;

    // ⚠️ الأرصدة (الخانتين) بتتحسب من الدفتر لحظيًا — مش متأثرة بفلتر الفترة
    const balance = await db.transaction((tx) => recomputeMerchantBalance(tx, merchantId));

    // آخر الحركات — تفصيل الممل لكل أوردر
    const lines = rowsOf<{
      awb: string;
      status: string;
      kind: string;
      net_p: string;
      cod_collected_p: string | null;
      shipping_p: string;
      other_fees_p: string;
      commission_p: string;
      compensation_p: string;
      recorded_at: string;
      picked_up_at: string | null;
      delivered_at: string | null;
      is_settled: boolean;
    }>(
      await db.execute(sql`
        SELECT s.awb, s.status, je.kind,
               (SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text
                  FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
                  WHERE a.code = 'MERCHANT_PAYABLE' AND a.owner_id = ${merchantId}::uuid
                    AND jl.shipment_id = s.id) AS net_p,
               s.cod_collected_p::text AS cod_collected_p,
               -- إيراد الشحن على الأوردر ده
               (SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text
                  FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
                  WHERE a.code = 'REVENUE_SHIPPING' AND jl.shipment_id = s.id) AS shipping_p,
               -- باقي رسوم الأوردر اللي بقت إيراد (تحصيل وقت التسليم/مرتجع/أخرى)
               (SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text
                  FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
                  WHERE a.type = 'revenue' AND a.code <> 'REVENUE_SHIPPING' AND jl.shipment_id = s.id) AS other_fees_p,
               -- عمولة المندوب على الأوردر ده (من جدول بنود العمولة)
               (SELECT COALESCE(SUM(cci.amount_p),0)::text
                  FROM courier_commission_items cci WHERE cci.shipment_id = s.id) AS commission_p,
               -- تعويضات على الأوردر ده
               (SELECT COALESCE(SUM(jl.debit_p - jl.credit_p),0)::text
                  FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
                  WHERE a.code = 'COMPENSATION_EXPENSE' AND jl.shipment_id = s.id) AS compensation_p,
               je.entry_date::text AS recorded_at,
               (SELECT h.occurred_at FROM shipment_status_history h
                 WHERE h.shipment_id = s.id AND h.to_status = 'picked_up'
                 ORDER BY h.occurred_at ASC LIMIT 1) AS picked_up_at,
               s.delivered_at::text AS delivered_at,
               s.is_settled
        FROM shipments s
        JOIN journal_entries je ON je.source_type = 'shipment' AND je.source_id = s.id
             AND je.kind IN ('delivery','partial_delivery','return','cancellation') AND je.is_reversal = false
        WHERE s.merchant_id = ${merchantId}::uuid ${win}
        ORDER BY je.entry_date DESC
        LIMIT 100
      `)
    );

    // ملخّص التاجر — إجماليات على كل أوردراته (مش محدود بالـ 100 سطر)
    const sumRow = rowsOf<{
      cod_collected: string;
      total_revenue: string;
      per_order_revenue: string;
      commission: string;
      compensation: string;
      orders: number;
    }>(
      await db.execute(sql`
        SELECT
          (SELECT COALESCE(SUM(s.cod_collected_p),0)::text
             FROM shipments s WHERE s.merchant_id = ${merchantId}::uuid AND s.cod_collected_p IS NOT NULL) AS cod_collected,
          -- كل إيراد الشركة من التاجر (رسوم الأوردرات + رسم التحصيل الأسبوعي عند التسوية)
          (SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text
             FROM journal_lines jl
             JOIN accounts a ON a.id = jl.account_id AND a.type = 'revenue'
             JOIN journal_entries je ON je.id = jl.entry_id
             WHERE jl.entry_id IN (
               SELECT jl2.entry_id FROM journal_lines jl2
               JOIN accounts a2 ON a2.id = jl2.account_id AND a2.code = 'MERCHANT_PAYABLE' AND a2.owner_id = ${merchantId}::uuid
             ) ${win}) AS total_revenue,
          -- إيراد الأوردرات وقت التسليم (بـ shipment_id) — الباقي = رسم التحصيل الأسبوعي
          (SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text
             FROM journal_lines jl
             JOIN accounts a ON a.id = jl.account_id AND a.type = 'revenue'
             JOIN journal_entries je ON je.id = jl.entry_id
             JOIN shipments s ON s.id = jl.shipment_id AND s.merchant_id = ${merchantId}::uuid
             WHERE 1=1 ${win}) AS per_order_revenue,
          (SELECT COALESCE(SUM(cci.amount_p),0)::text
             FROM courier_commission_items cci
             JOIN shipments s ON s.id = cci.shipment_id AND s.merchant_id = ${merchantId}::uuid) AS commission,
          (SELECT COALESCE(SUM(jl.debit_p - jl.credit_p),0)::text
             FROM journal_lines jl
             JOIN accounts a ON a.id = jl.account_id AND a.code = 'COMPENSATION_EXPENSE'
             JOIN journal_entries je ON je.id = jl.entry_id
             JOIN shipments s ON s.id = jl.shipment_id AND s.merchant_id = ${merchantId}::uuid
             WHERE 1=1 ${win}) AS compensation,
          (SELECT COUNT(*)::int FROM shipments s WHERE s.merchant_id = ${merchantId}::uuid) AS orders
      `)
    )[0];

    const codCollectedP = BigInt(sumRow?.cod_collected ?? "0");
    const totalRevenueP = BigInt(sumRow?.total_revenue ?? "0");
    const perOrderRevenueP = BigInt(sumRow?.per_order_revenue ?? "0");
    const commissionP = BigInt(sumRow?.commission ?? "0");
    const compensationP = BigInt(sumRow?.compensation ?? "0");
    const codFeeSettlementP = totalRevenueP - perOrderRevenueP; // رسم التحصيل الأسبوعي المنسوب عبر التسوية
    const profitP = totalRevenueP - commissionP - compensationP;

    // ملخّص عام لكل تاجر — الحقول المالية للمالية بس
    const summary = {
      ordersCount: sumRow?.orders ?? 0,
      codCollected: formatEGP(codCollectedP),
      codCollectedP: codCollectedP.toString(),
      ...(canSeeProfit
        ? {
            feesRevenue: formatEGP(totalRevenueP),
            feesRevenueP: totalRevenueP.toString(),
            codFeeSettlement: formatEGP(codFeeSettlementP),
            codFeeSettlementP: codFeeSettlementP.toString(),
            commission: formatEGP(commissionP),
            commissionP: commissionP.toString(),
            compensation: formatEGP(compensationP),
            compensationP: compensationP.toString(),
            profit: formatEGP(profitP),
            profitP: profitP.toString(),
          }
        : {}),
    };

    return ok({
      merchantId,
      canSeeProfit,
      period: { from, to },
      // الخانتين (لحظية — مش متأثرة بالفترة)
      confirmed: formatEGP(balance.confirmedP),
      inCollection: formatEGP(balance.inCollectionP),
      confirmedP: balance.confirmedP.toString(),
      inCollectionP: balance.inCollectionP.toString(),
      totalP: (balance.confirmedP + balance.inCollectionP).toString(),
      summary,
      lines: lines.map((l) => {
        const shippingP = BigInt(l.shipping_p);
        const otherFeesP = BigInt(l.other_fees_p);
        const feesRevenueP = shippingP + otherFeesP;
        const lineCommissionP = BigInt(l.commission_p);
        const lineCompensationP = BigInt(l.compensation_p);
        const lineProfitP = feesRevenueP - lineCommissionP - lineCompensationP;
        const base = {
          awb: l.awb,
          status: l.status,
          kind: l.kind,
          net: formatEGP(BigInt(l.net_p)),
          netP: l.net_p,
          codCollected: l.cod_collected_p ? formatEGP(BigInt(l.cod_collected_p)) : "—",
          codCollectedP: l.cod_collected_p ?? "0",
          shipping: formatEGP(shippingP),
          otherFees: formatEGP(otherFeesP),
          feesRevenue: formatEGP(feesRevenueP),
          feesRevenueP: feesRevenueP.toString(),
          recordedAt: l.recorded_at,
          pickedUpAt: l.picked_up_at,
          deliveredAt: l.delivered_at,
          settled: l.is_settled,
        };
        // 🔒 مكسب الشركة وتكلفة المندوب للمالية بس
        return canSeeProfit
          ? {
              ...base,
              commission: formatEGP(lineCommissionP),
              commissionP: lineCommissionP.toString(),
              compensation: formatEGP(lineCompensationP),
              compensationP: lineCompensationP.toString(),
              profit: formatEGP(lineProfitP),
              profitP: lineProfitP.toString(),
            }
          : base;
      }),
    });
  } catch (err) {
    return handleError(err);
  }
}
