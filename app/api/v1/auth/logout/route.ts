/**
 * POST /api/v1/auth/logout — إلغاء الجلسة الحالية.
 */
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { revokeSession, SESSION_COOKIE } from "@/server/auth/session";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    await revokeSession(db, token);
    const res = ok({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", expires: new Date(0) });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
