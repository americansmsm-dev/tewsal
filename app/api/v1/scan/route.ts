/** POST /api/v1/scan — محطة المسح (استلام الوارد في المخزن). */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { scanShipment } from "@/server/services/scan";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

const schema = z.object({
  awb: z.string().min(1).max(40),
  scanType: z.enum(["inbound", "outbound", "sort", "load", "unload"]).optional(),
  branchId: z.string().uuid().nullable().optional(),
  deviceId: z.string().max(60).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, OPS);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", "باركود غير صالح", 400);

    // نلفّ في ترانزاكشن — التحول والمسح مع بعض
    const result = await db.transaction((tx) =>
      scanShipment(tx, {
        awb: parsed.data.awb,
        scanType: parsed.data.scanType,
        branchId: parsed.data.branchId,
        deviceId: parsed.data.deviceId,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      })
    );

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
