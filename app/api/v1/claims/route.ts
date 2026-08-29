/**
 * GET /api/v1/claims — قائمة المطالبات (مفقود/تالف).
 * مالية/عمليات فقط.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE_OPS = ["super_admin", "branch_manager", "accountant", "ops"] as const;

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE_OPS);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

    const list = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT c.id, c.code, c.awb, c.type, c.status,
               c.declared_value_p::text, c.suggested_amount_p::text, c.approved_amount_p::text,
               c.is_fragile, c.fragile_blocked, c.reject_reason, c.created_at, c.resolved_at,
               m.name_ar AS merchant_name
        FROM claims c
        JOIN merchants m ON m.id = c.merchant_id
        WHERE 1=1 ${status ? sql`AND c.status = ${status}` : sql``}
        ORDER BY (c.status = 'open') DESC, c.created_at DESC
        LIMIT ${limit}
      `)
    );

    const claims = list.map((c) => ({
      ...c,
      declaredValue: formatEGP(BigInt((c.declared_value_p as string) || "0")),
      suggested: formatEGP(BigInt((c.suggested_amount_p as string) || "0")),
      approved: c.approved_amount_p != null ? formatEGP(BigInt(c.approved_amount_p as string)) : null,
    }));

    return ok({ claims, count: claims.length });
  } catch (err) {
    return handleError(err);
  }
}
