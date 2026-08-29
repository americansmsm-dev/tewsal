/**
 * POST /api/v1/shipments/:id/attachments/upload?kind=pod_photo
 * رفع صورة إثبات عبر السيرفر (جسم الطلب = الصورة الخام).
 * السيرفر يرفعها لـ R2 ويسجّلها — مفيش CORS. المندوب/العمليات.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { uploadAttachment } from "@/server/services/attachment";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FIELD = ["super_admin", "branch_manager", "ops", "courier"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FIELD);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    const kind = new URL(req.url).searchParams.get("kind") ?? "pod_photo";
    const contentType = req.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await req.arrayBuffer());

    const result = await db.transaction((tx) =>
      uploadAttachment(tx, { shipmentId: id, kind, contentType, bytes: buf, actorUserId: ctx.user.userId })
    );
    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}
