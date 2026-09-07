/**
 * POST /api/v1/settlements/:id/approve — اعتماد تسوية.
 * فوق الحد بيحتاج شخصين مختلفين (قرار ٦).
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { approveSettlement } from "@/server/services/settlement";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";
import { notifySettlementApproved } from "@/server/services/inappNotify";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    if (!ctx.user.userId) return fail("NO_USER", "الاعتماد محتاج مستخدم معروف", 422);

    const result = await db.transaction((tx) =>
      approveSettlement(tx, { settlementId: id, actorUserId: ctx.user.userId! })
    );

    // اتعتمدت خلاص؟ التاجر يعرف. (لسه مستنية اعتماد تاني → مانزعجوش)
    if (result.status === "approved") {
      void (async () => {
        try {
          const rows = await db.execute(sql`
            SELECT code, merchant_id::text AS merchant_id FROM settlements WHERE id = ${id}::uuid`);
          const r = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows)[0] as
            { code: string; merchant_id: string } | undefined;
          if (r) {
            await notifySettlementApproved(db, {
              settlementId: id, code: r.code, merchantId: r.merchant_id,
            });
          }
        } catch (err) {
          console.error("[notify] فشل إشعار اعتماد التسوية:", err instanceof Error ? err.message : err);
        }
      })();
    }
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
