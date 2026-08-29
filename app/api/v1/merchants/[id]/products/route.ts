/** /api/v1/merchants/:id/products — منتجات التاجر المخزّنة. GET · POST. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { createProduct, listProducts } from "@/server/services/fulfillment";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, OPS);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const products = await listProducts(db, id);
    return ok({ products, count: products.length });
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  sku: z.string().min(1).max(60),
  nameAr: z.string().min(1).max(160),
  category: z.string().max(80).nullable().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  quantity: z.number().int().min(0).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, OPS);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => createProduct(tx, { merchantId: id, ...parsed.data }));
    return ok(result, 201);
  } catch (err) { return handleError(err); }
}
