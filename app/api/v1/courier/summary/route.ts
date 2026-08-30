/**
 * GET /api/v1/courier/summary — إجماليات المندوب لنفسه:
 *  عهدة الكاش · العمولات المستحقة · العجز/الذمم · إحصائيات النهاردة.
 * بيغذّي شاشتي «الرئيسية» و«حسابي» في تطبيق المندوب.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { accountBalance } from "@/server/services/ledger";
import { ACC } from "@/server/domain/ledger";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole(req, ["courier", "super_admin", "branch_manager", "accountant"]);
    const courierId = ctx.user.userId;
    if (!courierId) return ok(empty());

    // أرصدة الدفتر
    const [cashP, commRaw, recvP] = await Promise.all([
      accountBalance(db, ACC.courierCash(courierId)),          // أصل: موجب = كاش معايا
      accountBalance(db, ACC.courierCommissionPayable(courierId)), // التزام: مدين−دائن (سالب)
      accountBalance(db, ACC.courierReceivable(courierId)),     // أصل: موجب = عليّ ذمم
    ]);
    const commissionsP = commRaw < 0n ? -commRaw : 0n; // المستحق للمندوب

    // إحصائيات النهاردة (توقيت القاهرة)
    const [stats] = rowsOf<{ delivered: string; partial: string; failed: string; out: string }>(
      await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status='delivered'
            AND (delivered_at AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date)::text AS delivered,
          COUNT(*) FILTER (WHERE status='partially_delivered'
            AND (delivered_at AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date)::text AS partial,
          COUNT(*) FILTER (WHERE status='delivery_failed'
            AND (updated_at AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date)::text AS failed,
          COUNT(*) FILTER (WHERE status='out_for_delivery')::text AS out
        FROM shipments WHERE current_courier_id = ${courierId}::uuid
      `)
    );
    const delivered = Number(stats?.delivered ?? 0) + Number(stats?.partial ?? 0);
    const failed = Number(stats?.failed ?? 0);
    const attempts = delivered + failed;
    const successRate = attempts > 0 ? Math.round((delivered / attempts) * 100) : null;

    return ok({
      cashInHandP: cashP.toString(),
      cashInHand: formatEGP(cashP),
      commissionsP: commissionsP.toString(),
      commissions: formatEGP(commissionsP),
      receivableP: recvP.toString(),
      receivable: formatEGP(recvP),
      today: {
        delivered,
        failed,
        outForDelivery: Number(stats?.out ?? 0),
        successRate,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

function empty() {
  return {
    cashInHandP: "0", cashInHand: formatEGP(0n),
    commissionsP: "0", commissions: formatEGP(0n),
    receivableP: "0", receivable: formatEGP(0n),
    today: { delivered: 0, failed: 0, outForDelivery: 0, successRate: null },
  };
}
