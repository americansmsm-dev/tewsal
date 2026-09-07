/**
 * POST /api/v1/returns/dispatch — تحميل مرتجعات على مندوب.
 *
 * إجراء واحد: بينشئ كشف مرتجعات ويحمّل عليه الشحنات المختارة
 * ويسندها للمندوب — الشحنات بتبقى out_for_return وتظهر في
 * تطبيق المندوب على طول.
 *
 * عمليات/إدارة بس.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { dispatchReturns } from "@/server/services/returns";
import { notifyReturnsDispatched } from "@/server/services/inappNotify";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

const schema = z.object({
  courierId: z.string().uuid("اختار مندوب"),
  shipmentIds: z.array(z.string().uuid()).min(1, "اختار مرتجع واحد على الأقل").max(500),
  notes: z.string().max(1000).nullable().optional(),
});

/** كود كشف المرتجعات RRS-YYYY-NNNNNN — من نفس متتالية الأرقام */
function returnSheetCode(seq: string): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `RRS-${year}-${seq.padStart(6, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, OPS);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const { courierId, shipmentIds, notes } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const seqR = await tx.execute(sql`SELECT nextval('awb_sequence')::text AS n`);
      const n = (Array.isArray(seqR) ? seqR : (seqR as { rows: { n: string }[] }).rows)[0] as { n: string };
      return dispatchReturns(tx, {
        courierId,
        shipmentIds,
        notes: notes ?? null,
        code: returnSheetCode(n.n),
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      });
    });

    // إشعار المندوب إن فيه مرتجعات اتحمّلت عليه — best-effort بعد الكوميت
    void (async () => {
      try {
        await notifyReturnsDispatched(db, {
          runSheetId: result.runSheetId,
          code: result.code,
          courierId,
          count: result.dispatched,
        });
      } catch (err) {
        // الإشعار مايوقّفش العملية — بس الفشل بيتسجّل مش بيتبلع
        console.error("[notify] فشل إشعار تحميل مرتجعات:", err instanceof Error ? err.message : err);
      }
    })();

    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}
