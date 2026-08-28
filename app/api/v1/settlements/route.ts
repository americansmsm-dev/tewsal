/**
 * ============================================================
 *  /api/v1/settlements — التسويات
 * ------------------------------------------------------------
 *  POST: تشغيل تسوية لتاجر (المحاسب/الإدارة)
 *  GET:  قائمة التسويات
 * ============================================================
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { runSettlement } from "@/server/services/settlement";
import { requireRole, requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

const runSchema = z.object({
  merchantId: z.string().uuid(),
  /** ساعة الإغلاق ISO — الافتراضي دلوقتي */
  cutoffAt: z.string().datetime().optional(),
});

/** كود تسوية مقروء: STL-YYYY-XXXXXX */
function settlementCode(seqPart: string): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `STL-${year}-${seqPart}`;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const raw = await req.json().catch(() => null);
    const parsed = runSchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const cutoffAt = parsed.data.cutoffAt ? new Date(parsed.data.cutoffAt) : new Date();

    const result = await db.transaction(async (tx) => {
      // رقم متسلسل للكود
      const seqRows = await tx.execute(sql`SELECT nextval('awb_sequence')::text AS n`);
      const n = (Array.isArray(seqRows) ? seqRows : (seqRows as { rows: { n: string }[] }).rows)[0] as { n: string };
      const code = settlementCode(n.n.padStart(6, "0"));
      return runSettlement(tx, {
        merchantId: parsed.data.merchantId,
        cutoffAt,
        code,
        actorUserId: ctx.user.userId,
      });
    });

    return ok(
      {
        settlementId: result.settlementId,
        code: result.code,
        itemCount: result.itemCount,
        netPayable: formatEGP(result.netPayableP),
        netPayableP: result.netPayableP.toString(),
        requiresTwoApprovals: result.requiresTwoApprovals,
        status: result.status,
      },
      201
    );
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchantId");
    const status = url.searchParams.get("status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

    const rows = await db.execute(sql`
      SELECT s.id, s.code, s.merchant_id, s.status, s.net_payable_p::text, s.requires_two_approvals,
             (s.approved_by IS NOT NULL) AS approved_once,
             (s.second_approved_by IS NOT NULL) AS approved_twice,
             s.created_at, s.paid_at,
             m.name_ar AS merchant_name, m.code AS merchant_code
      FROM settlements s
      LEFT JOIN merchants m ON m.id = s.merchant_id
      WHERE 1=1
        ${merchantId ? sql`AND s.merchant_id = ${merchantId}::uuid` : sql``}
        ${status ? sql`AND s.status = ${status}` : sql``}
      ORDER BY s.created_at DESC LIMIT ${limit}
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ settlements: list, count: list.length });
  } catch (err) {
    return handleError(err);
  }
}
