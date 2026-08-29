/**
 * POST /api/v1/imports — { action: 'preview'|'commit', merchantId, rows }
 * معاينة أخطاء الاستيراد أو تنفيذه. عمليات.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { previewImport, commitImport } from "@/server/services/imports";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

const rowSchema = z.object({
  recipientName: z.string().optional(),
  recipientPhone: z.string().optional(),
  governorate: z.string().optional(),
  addressLine: z.string().optional(),
  codAmount: z.string().optional(),
  merchantReference: z.string().optional(),
});
const schema = z.object({
  action: z.enum(["preview", "commit"]),
  merchantId: z.string().uuid(),
  rows: z.array(rowSchema).min(1).max(2000),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, OPS);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const { action, merchantId, rows } = parsed.data;

    if (action === "preview") {
      return ok(await previewImport(db, { merchantId, rows }));
    }
    const result = await db.transaction((tx) =>
      commitImport(tx, { merchantId, rows, actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName } })
    );
    return ok(result, 201);
  } catch (err) { return handleError(err); }
}
