/**
 * ============================================================
 *  POST /api/v1/shipments/:id/transitions
 * ------------------------------------------------------------
 *  الـ endpoint اللي بيغلّف البوابة الوحيدة applyTransition.
 *
 *  بيعمل:
 *   ١) يتأكد إن فيه مستخدم مسجّل (401 غير كده)
 *   ٢) يتحقق من المدخلات (Zod) ويحوّل الفلوس لقروش
 *   ٣) جوه ترانزاكشن: يبني القيد المالي لو التحول مالي،
 *      ثم ينده applyTransition
 *   ٤) يترجم أكواد أخطاء البوابة لأكواد HTTP:
 *        REASSIGNED/VERSION_CONFLICT/... → 409
 *        NOT_ALLOWED → 403 · FINANCIAL_REQUIRED → 422
 *
 *  ⚠️ التحول والقيد المالي في **نفس الترانزاكشن** — إما
 *     الاتنين أو ولا واحد.
 * ============================================================
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { poundsToPiastres } from "@/lib/money";
import { SHIPMENT_STATUSES } from "@/server/domain/statusMachine";
import { applyTransition, type TransitionInput } from "@/server/services/transition";
import type { Role } from "@/server/domain/statusMachine";
import { buildTransitionFinancialEntry } from "@/server/services/shipmentFinancials";
import { openClaim } from "@/server/services/claim";
import { enterReturns } from "@/server/services/returns";
import { recordAttachment } from "@/server/services/attachment";
import { fireWebhooks } from "@/server/services/apiAccess";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError, forbidden } from "@/server/http/respond";
import type { UserRole } from "@/server/db/schema/identity";

/** كود المطالبة CLM-YYYY-NNNNNN */
function claimCode(seq: string): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `CLM-${year}-${seq.padStart(6, "0")}`;
}

export const dynamic = "force-dynamic";

/** أدوار المستخدمين → أدوار آلة الحالات (نفس القيم + system) */
const ROLE_MAP: Record<UserRole, Role> = {
  super_admin: "super_admin",
  branch_manager: "branch_manager",
  ops: "ops",
  courier: "courier",
  merchant: "merchant",
  accountant: "accountant",
  support: "support",
};

const moneyString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "مبلغ غير صالح — أرقام موجبة بحد أقصى منزلتين عشريتين");

const bodySchema = z.object({
  to: z.enum(SHIPMENT_STATUSES as unknown as [string, ...string[]]),

  // التزامن
  expectedStatus: z.enum(SHIPMENT_STATUSES as unknown as [string, ...string[]]).optional(),
  expectedVersion: z.number().int().positive().optional(),
  expectedCourierId: z.string().uuid().nullable().optional(),

  // إيدمبوتنسي الـ PWA
  deviceEventId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
  wasOffline: z.boolean().optional(),
  source: z.string().max(20).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),

  // المتطلبات
  reasonCode: z.string().max(40).optional(),
  note: z.string().max(2000).optional(),
  receiverName: z.string().max(120).optional(),
  photoUrl: z.string().max(500).optional(),
  signatureUrl: z.string().max(500).optional(),
  opsPreauthByUserId: z.string().uuid().optional(),

  // التحصيل — بالجنيه، بيتحوّل لقروش
  cod: z
    .object({ collected: moneyString, method: z.string().min(1).max(30) })
    .optional(),

  // التشغيل
  courierId: z.string().uuid().nullable().optional(),
  runSheetId: z.string().uuid().nullable().optional(),
  pickupId: z.string().uuid().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: shipmentId } = await params;
    if (!z.string().uuid().safeParse(shipmentId).success) {
      return fail("BAD_REQUEST", "رقم الشحنة غير صالح", 400);
    }

    const ctx = await requireUser(req);

    // المندوب ملوش لازمة يبعت لوحة الإدارة — بس ده بيتفلتر في canTransition
    if (ctx.user.role === "merchant") {
      // التاجر بيغيّر حالات محدودة جدًا (إلغاء المسودة) — نسيبها للبوابة
    }

    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات غير صالحة", 400);
    }
    const b = parsed.data;

    const role = ROLE_MAP[ctx.user.role];
    if (!role) return handleError(forbidden());

    const cod = b.cod
      ? { collectedP: poundsToPiastres(b.cod.collected), method: b.cod.method }
      : undefined;

    const result = await db.transaction(async (tx) => {
      // البوابة الوحيدة — بتنده بنّاء القيد المالي **بعد** ما
      // تتأكد إن التحول مسموح، عشان الممنوع يرجّع NOT_ALLOWED
      // مش خطأ بناء قيد.
      const res = await applyTransition(tx, {
        shipmentId,
        to: b.to as TransitionInput["to"],
        actor: { userId: ctx.user.userId, role, name: ctx.user.fullName },
        expectedStatus: b.expectedStatus as TransitionInput["expectedStatus"],
        expectedVersion: b.expectedVersion,
        expectedCourierId: b.expectedCourierId,
        deviceEventId: b.deviceEventId,
        occurredAt: b.occurredAt ? new Date(b.occurredAt) : undefined,
        wasOffline: b.wasOffline,
        source: b.source ?? "web",
        lat: b.lat,
        lng: b.lng,
        reasonCode: b.reasonCode,
        note: b.note,
        receiverName: b.receiverName,
        photoUrl: b.photoUrl,
        signatureUrl: b.signatureUrl,
        opsPreauthByUserId: b.opsPreauthByUserId,
        cod,
        courierId: b.courierId,
        runSheetId: b.runSheetId,
        pickupId: b.pickupId,
        buildFinancialEntry: (exec) =>
          buildTransitionFinancialEntry(exec, {
            shipmentId,
            to: b.to as TransitionInput["to"],
            cod,
          }),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });

      // ⚠️ مفقود/تالف بيفتح مطالبة تلقائيًا (بدون قيد فوري) —
      //    جوه نفس الترانزاكشن، والبوابة نفسها مش بتتلمس.
      let claimId: string | null = null;
      if (!res.idempotentReplay && (b.to === "lost" || b.to === "damaged")) {
        const seqR = await tx.execute(sql`SELECT nextval('awb_sequence')::text AS n`);
        const n = (Array.isArray(seqR) ? seqR : (seqR as { rows: { n: string }[] }).rows)[0] as { n: string };
        const claim = await openClaim(tx, { shipmentId, code: claimCode(n.n), actorUserId: ctx.user.userId });
        claimId = claim.claimId;
      }

      // ⚠️ دخول المرتجعات بيسجّل الشحنة في سجل المرتجعات تلقائيًا
      //    (للرف والعمر والتصعيد) — نفس الترانزاكشن، بدون قيد.
      if (!res.idempotentReplay && b.to === "awaiting_return") {
        await enterReturns(tx, { shipmentId, actorUserId: ctx.user.userId });
      }

      // ⚠️ صور الإثبات/التوقيع اللي جت مع التحول بتتربط بالشحنة
      //    كمرفقات (المندوب رفعها لـ R2 قبل كده وبعت المفتاح).
      if (!res.idempotentReplay) {
        const photoKind = b.to === "damaged" ? "damage" : "pod_photo";
        if (b.photoUrl) {
          await recordAttachment(tx, { shipmentId, kind: photoKind, r2Key: b.photoUrl, actorUserId: ctx.user.userId });
        }
        if (b.signatureUrl) {
          await recordAttachment(tx, { shipmentId, kind: "signature", r2Key: b.signatureUrl, actorUserId: ctx.user.userId });
        }
      }
      return { res, claimId };
    });

    // إشعار ويب-هوك التاجر (best-effort، مش بيعطّل الرد ولا الترانزاكشن)
    const NOTIFY = new Set(["picked_up", "out_for_delivery", "delivered", "partially_delivered", "delivery_failed", "returned_to_merchant"]);
    if (!result.res.idempotentReplay && NOTIFY.has(b.to)) {
      void (async () => {
        try {
          const m = await db.execute(sql`SELECT merchant_id::text AS mid FROM shipments WHERE id = ${shipmentId}::uuid`);
          const mid = (Array.isArray(m) ? m : (m as { rows: { mid: string }[] }).rows)[0]?.mid as string | undefined;
          if (mid) await fireWebhooks(db, { merchantId: mid, event: String(b.to), payload: { awb: result.res.awb, status: b.to, shipmentId } });
        } catch { /* best-effort */ }
      })();
    }

    return ok(
      {
        shipmentId: result.res.shipmentId,
        awb: result.res.awb,
        from: result.res.fromStatus,
        to: result.res.toStatus,
        version: result.res.version,
        journalEntryNo: result.res.journalEntryNo?.toString() ?? null,
        promisedAt: result.res.promisedAt?.toISOString() ?? null,
        idempotentReplay: result.res.idempotentReplay,
        claimId: result.claimId,
      },
      result.res.idempotentReplay ? 200 : 201
    );
  } catch (err) {
    return handleError(err);
  }
}
