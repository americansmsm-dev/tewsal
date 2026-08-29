/**
 * /api/v1/shipments/:id/attachments — مرفقات الشحنة (صور الإثبات)
 * GET:  قائمة المرفقات + روابط عرض مؤقتة
 * POST: تسجيل مرفق بعد رفعه لـ R2 (بالمفتاح)
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAttachment, listAttachments } from "@/server/services/attachment";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FIELD = ["super_admin", "branch_manager", "ops", "courier"] as const;
const VIEW = ["super_admin", "branch_manager", "ops", "accountant", "support"] as const;

const recordSchema = z.object({
  kind: z.string().min(1).max(30),
  key: z.string().min(1).max(300),
  sha256: z.string().max(64).nullable().optional(),
  sizeBytes: z.number().int().positive().nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, VIEW);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const attachments = await listAttachments(db, id);
    return ok({ attachments, count: attachments.length });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FIELD);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction((tx) =>
      recordAttachment(tx, {
        shipmentId: id,
        kind: parsed.data.kind,
        r2Key: parsed.data.key,
        sha256: parsed.data.sha256 ?? null,
        sizeBytes: parsed.data.sizeBytes ?? null,
        actorUserId: ctx.user.userId,
      })
    );
    return ok(result, result.alreadyExists ? 200 : 201);
  } catch (err) {
    return handleError(err);
  }
}
