/** POST /api/v1/profile/avatar — رفع صورة البروفايل (جسم الطلب = الصورة). */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { isR2Configured, putObject, presignGet, extForContentType } from "@/lib/r2";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    if (!isR2Configured()) return fail("NO_STORAGE", "تخزين الصور مش متاح دلوقتي", 503);
    const contentType = req.headers.get("content-type") ?? "";
    const ext = extForContentType(contentType);
    if (!ext) return fail("BAD_TYPE", "الصورة لازم JPG أو PNG أو WEBP", 400);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength === 0) return fail("EMPTY", "مفيش صورة", 400);
    if (bytes.byteLength > 5_000_000) return fail("TOO_BIG", "الصورة أكبر من ٥ ميجا", 400);

    const key = `avatars/${ctx.user.userId}-${Date.now()}.${ext}`;
    await putObject(key, bytes, contentType);
    await db.execute(sql`UPDATE users SET avatar_url = ${key}, updated_at = now() WHERE id = ${ctx.user.userId}::uuid`);
    const viewUrl = await presignGet(key).catch(() => null);
    return ok({ avatarUrl: key, viewUrl }, 201);
  } catch (err) { return handleError(err); }
}
