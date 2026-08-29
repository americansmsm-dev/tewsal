/**
 * ============================================================
 *  خدمة محطة المسح — Scan
 * ------------------------------------------------------------
 *  الموظف بيمسح باركود البوليصة في المحطة. المسح الأساسي:
 *  **الوارد (inbound)** — استلام الشحنة في المخزن
 *  (picked_up → at_hub) عبر البوابة applyTransition.
 *
 *  كل مسحة بتتسجّل في scan_events **حتى المرفوضة** (تحقيق
 *  جنائي). البوابة نفسها مش بتتلمس.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { applyTransition, type Actor } from "./transition";
import { type SqlExecutor } from "./ledger";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export interface ScanResult {
  ok: boolean;
  rejected: boolean;
  reason: string | null;
  awb: string;
  shipmentId: string | null;
  recipientName: string | null;
  governorate: string | null;
  merchant: string | null;
  status: string | null;
  already: boolean;
}

interface ScanContext {
  awb: string;
  scanType: string;
  branchId: string | null;
  userId: string | null;
  deviceId: string | null;
}

/** تسجيل حدث مسح (INSERT فقط — الجدول append-only) */
async function recordScan(
  ex: SqlExecutor,
  c: ScanContext,
  shipmentId: string | null,
  resultingStatus: string | null,
  wasRejected: boolean,
  rejectReason: string | null
): Promise<void> {
  await ex.execute(sql`
    INSERT INTO scan_events
      (awb, shipment_id, scan_type, branch_id, user_id, device_id, resulting_status, was_rejected, reject_reason)
    VALUES (
      ${c.awb}, ${shipmentId}::uuid, ${c.scanType}, ${c.branchId}::uuid,
      ${c.userId}::uuid, ${c.deviceId}, ${resultingStatus},
      ${wasRejected}, ${rejectReason}
    )
  `);
}

export async function scanShipment(
  ex: SqlExecutor,
  input: { awb: string; scanType?: string; branchId?: string | null; deviceId?: string | null; actor: Actor }
): Promise<ScanResult> {
  const awb = input.awb.trim();
  const c: ScanContext = {
    awb, scanType: input.scanType ?? "inbound", branchId: input.branchId ?? null,
    userId: input.actor.userId, deviceId: input.deviceId ?? null,
  };
  const empty: ScanResult = {
    ok: false, rejected: true, reason: null, awb, shipmentId: null,
    recipientName: null, governorate: null, merchant: null, status: null, already: false,
  };

  // البوليصة → الشحنة (قفل عشان التزامن مع أي تحول)
  const ship = rowsOf<{ id: string; status: string; recipient: string; gov: string | null; merchant: string | null }>(
    await ex.execute(sql`
      SELECT s.id::text AS id, s.status, s.recipient_name AS recipient,
             g.name_ar AS gov, m.name_ar AS merchant
      FROM shipments s
      LEFT JOIN governorates g ON g.id = s.governorate_id
      LEFT JOIN merchants m ON m.id = s.merchant_id
      WHERE s.awb = ${awb}
      FOR UPDATE OF s
    `)
  )[0];

  if (!ship) {
    await recordScan(ex, c, null, null, true, "البوليصة مش موجودة");
    return { ...empty, reason: "البوليصة مش موجودة" };
  }

  const display = {
    shipmentId: ship.id, recipientName: ship.recipient, governorate: ship.gov, merchant: ship.merchant,
  };

  // ─── مسح الوارد: استلام في المخزن ───
  if (c.scanType === "inbound") {
    if (ship.status === "at_hub") {
      await recordScan(ex, c, ship.id, "at_hub", false, "مستلمة قبل كده");
      return { ...empty, ...display, ok: true, rejected: false, reason: "مستلمة قبل كده", status: "at_hub", already: true };
    }
    if (ship.status !== "picked_up") {
      const reason = `مش قابلة للاستلام — حالتها (${ship.status})`;
      await recordScan(ex, c, ship.id, ship.status, true, reason);
      return { ...empty, ...display, reason, status: ship.status };
    }
    // picked_up → at_hub عبر البوابة
    await applyTransition(ex, {
      shipmentId: ship.id, to: "at_hub", actor: input.actor, expectedStatus: "picked_up", source: "scan",
    });
    await recordScan(ex, c, ship.id, "at_hub", false, null);
    return { ...empty, ...display, ok: true, rejected: false, reason: null, status: "at_hub" };
  }

  // ─── أنواع مسح تانية: تسجيل معلوماتي بدون تحول ───
  await recordScan(ex, c, ship.id, ship.status, false, null);
  return { ...empty, ...display, ok: true, rejected: false, reason: null, status: ship.status };
}
