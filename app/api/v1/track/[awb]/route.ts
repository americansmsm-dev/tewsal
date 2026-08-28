/**
 * ============================================================
 *  GET /api/v1/track/:awb — التتبع العام (بدون تسجيل دخول)
 * ------------------------------------------------------------
 *  ⚠️ الخصوصية أهم حاجة هنا. العميل بيشوف:
 *   ✅ خط زمني عربي للحالات · الموعد المتوقع · اسم ورقم المندوب
 *      (بس لما يخرج للتسليم) — مقنّعين
 *   ❌ مبلغ التحصيل · اسم التاجر · العنوان الكامل · رسوم الشحن
 *
 *  الاسم والرقم بيظهروا **مقنّعين** (أح*** · 010****1234).
 * ============================================================
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { normalizeAwb, isValidAwb } from "@/lib/awb";
import { maskPhone, maskName } from "@/lib/phone";
import { PUBLIC_STATUS_LABELS_AR, type ShipmentStatus } from "@/server/domain/statusMachine";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ awb: string }> }) {
  try {
    const { awb: rawAwb } = await params;
    const awb = normalizeAwb(rawAwb);
    if (!awb || !isValidAwb(awb)) {
      return fail("BAD_AWB", "رقم بوليصة غير صالح", 400);
    }

    const ship = rowsOf<{
      id: string;
      status: ShipmentStatus;
      promised_at: string | null;
      out_for_delivery: boolean;
      courier_name: string | null;
      courier_phone: string | null;
      governorate: string;
    }>(
      await db.execute(sql`
        SELECT s.id, s.status, s.promised_at::text,
               (s.status = 'out_for_delivery') AS out_for_delivery,
               u.full_name AS courier_name, u.phone AS courier_phone,
               g.name_ar AS governorate
        FROM shipments s
        JOIN governorates g ON g.id = s.governorate_id
        LEFT JOIN users u ON u.id = s.current_courier_id
        WHERE s.awb = ${awb}
        LIMIT 1
      `)
    )[0];

    if (!ship) {
      // مبنقولش "مش موجود" بتفصيل — رد موحّد ضد تخمين الأرقام
      return fail("NOT_FOUND", "مفيش شحنة بالرقم ده", 404);
    }

    // الخط الزمني — الحالات اللي العميل بيشوفها بس
    const history = rowsOf<{ to_status: ShipmentStatus; recorded_at: string }>(
      await db.execute(sql`
        SELECT to_status, recorded_at::text
        FROM shipment_status_history
        WHERE shipment_id = ${ship.id}::uuid
        ORDER BY recorded_at ASC
      `)
    );

    const timeline = history
      .filter((h) => PUBLIC_STATUS_LABELS_AR[h.to_status])
      .map((h) => ({
        status: h.to_status,
        label: PUBLIC_STATUS_LABELS_AR[h.to_status],
        at: h.recorded_at,
      }));

    // بيانات المندوب بتظهر بس لما يخرج للتسليم
    const courier =
      ship.out_for_delivery && ship.courier_name
        ? {
            name: maskName(ship.courier_name),
            phone: ship.courier_phone ? maskPhone(ship.courier_phone) : null,
          }
        : null;

    return ok({
      awb,
      status: ship.status,
      statusLabel: PUBLIC_STATUS_LABELS_AR[ship.status] ?? "جاري المعالجة",
      governorate: ship.governorate,
      promisedAt: ship.promised_at,
      courier,
      timeline,
    });
  } catch (err) {
    return handleError(err);
  }
}
