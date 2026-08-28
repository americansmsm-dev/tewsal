/**
 * POST /api/v1/handovers — تسجيل تسليم عهدة مندوب.
 * المتوقع بيتحسب من الدفتر؛ الكاشير بيدخل المبلغ المعدود.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { poundsToPiastres, formatEGP } from "@/lib/money";
import { recordHandover } from "@/server/services/handover";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

const schema = z.object({
  courierId: z.string().uuid(),
  received: z.string().regex(/^\d+(\.\d{1,2})?$/, "مبلغ غير صالح"),
  varianceNote: z.string().max(500).optional(),
});

function handoverCode(seq: string): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `HO-${year}-${seq.padStart(6, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const [branch] = await (async () => {
      const r = await db.execute(sql`SELECT id FROM branches WHERE code = 'MAIN' LIMIT 1`);
      return (Array.isArray(r) ? r : (r as { rows: { id: string }[] }).rows) as { id: string }[];
    })();
    if (!branch) return fail("NO_BRANCH", "مفيش فرع رئيسي", 422);

    const result = await db.transaction(async (tx) => {
      const seqR = await tx.execute(sql`SELECT nextval('awb_sequence')::text AS n`);
      const n = (Array.isArray(seqR) ? seqR : (seqR as { rows: { n: string }[] }).rows)[0] as { n: string };
      return recordHandover(tx, {
        courierId: parsed.data.courierId,
        branchId: branch.id,
        receivedP: poundsToPiastres(parsed.data.received),
        code: handoverCode(n.n),
        actorUserId: ctx.user.userId,
        varianceNote: parsed.data.varianceNote ?? null,
      });
    });

    return ok(
      {
        code: result.code,
        expected: formatEGP(result.expectedP),
        received: formatEGP(result.receivedP),
        variance: formatEGP(result.varianceP),
        varianceP: result.varianceP.toString(),
        journalEntryNo: result.journalEntryNo.toString(),
      },
      201
    );
  } catch (err) {
    return handleError(err);
  }
}
