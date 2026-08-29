/** POST /api/public/v1/rate — تقييم العميل بعد التسليم (عام، بالبوليصة). */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { rateDelivery } from "@/server/services/notifications";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const schema = z.object({ awb: z.string().min(3).max(40), stars: z.number().int().min(1).max(5), comment: z.string().max(500).nullable().optional() });

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    return ok(await db.transaction((tx) => rateDelivery(tx, parsed.data)), 201);
  } catch (err) { return handleError(err); }
}
