/**
 * POST /api/public/v1/shipments — الـ API العام للتجار.
 * المصادقة: Authorization: Bearer tw_xxx (توكن التاجر).
 * بينشئ شحنة للتاجر صاحب التوكن عبر نفس بوابة createShipment.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { authToken } from "@/server/services/apiAccess";
import { createShipment } from "@/server/services/createShipment";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const schema = z.object({
  recipientName: z.string().min(1).max(120),
  recipientPhone: z.string().min(6).max(20),
  governorateId: z.string().uuid(),
  addressLine: z.string().min(1).max(300),
  codAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  merchantReference: z.string().max(120).optional(),
  landmark: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const raw = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction(async (tx) => {
      const { merchantId } = await authToken(tx, raw);
      return createShipment(tx, { merchantId, ...parsed.data, confirm: true }, { userId: null, role: "merchant", name: "API" });
    });
    return ok({ awb: result.awb, id: result.id, price: formatEGP(result.priceP), status: result.status }, 201);
  } catch (err) { return handleError(err); }
}
