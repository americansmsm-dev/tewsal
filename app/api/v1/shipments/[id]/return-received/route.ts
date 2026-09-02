/**
 * POST /api/v1/shipments/:id/return-received
 *  مسؤول المخزن (العمليات) بيأكّد إنه استلم المرتجع من المندوب.
 *  المرتجع بيفضل في عهدة المندوب (current_courier_id) لحد ما يتأكّد هنا —
 *  ساعتها بنشيل المندوب فيخرج من عهدته. الحالة بتفضل awaiting_return
 *  (على الرف في المخزن) — بيتظبط شلفه لاحقًا من صفحة المرتجعات.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, OPS);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const rows = await db.execute(sql`
      UPDATE shipments SET current_courier_id = NULL, updated_at = now()
      WHERE id = ${id}::uuid AND status = 'awaiting_return'
      RETURNING id
    `);
    const r = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows)[0] as { id: string } | undefined;
    if (!r) return fail("NOT_APPLICABLE", "المرتجع ده مش في حالة الاستلام", 409);
    return ok({ id: r.id, received: true });
  } catch (err) {
    return handleError(err);
  }
}
