/**
 * POST /api/v1/shipments/:id/attachments/presign — رابط رفع مؤقت لـ R2.
 * المندوب بياخد الرابط ويرفع الصورة **مباشرة** لـ R2، وبعدين
 * يسجّل المفتاح عبر POST /attachments.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { presignUpload } from "@/server/services/attachment";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FIELD = ["super_admin", "branch_manager", "ops", "courier"] as const;

const schema = z.object({
  kind: z.string().min(1).max(30),
  contentType: z.string().min(1).max(60),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, FIELD);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await presignUpload(db, {
      shipmentId: id,
      kind: parsed.data.kind,
      contentType: parsed.data.contentType,
    });
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
