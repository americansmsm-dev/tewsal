/**
 * ============================================================
 *  الإشعارات والتواصل — مرحلة د
 * ------------------------------------------------------------
 *  sendNotification   — يتحقق من الحد اليومي، يرندر القالب،
 *                       يبعت (أو يحاكي)، ويسجّل بالتكلفة.
 *  notifyStatusChange — بيتنده من راوت التحول (best-effort).
 *  rateDelivery       — تقييم العميل بعد التسليم.
 *  templates: list/update ؛ log: list.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { isWhatsappConfigured, sendWhatsapp } from "@/lib/whatsapp";
import { type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}
async function numSetting(ex: SqlExecutor, key: string, fallback: number): Promise<number> {
  const v = rowsOf<{ value: unknown }>(await ex.execute(sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1`))[0]?.value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function render(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export interface SendResult { status: string; body?: string }

/** إرسال إشعار (أو محاكاته لو الواتساب مش متضبط). */
export async function sendNotification(
  ex: SqlExecutor,
  input: { merchantId: string | null; shipmentId: string | null; toPhone: string; event: string; channel?: string; vars: Record<string, string> }
): Promise<SendResult> {
  const channel = input.channel ?? "whatsapp";
  const tmpl = rowsOf<{ body_ar: string }>(
    await ex.execute(sql`SELECT body_ar FROM notification_templates WHERE key = ${input.event} AND channel = ${channel} AND is_active = true LIMIT 1`)
  )[0];
  if (!tmpl) return { status: "no_template" };
  const body = render(tmpl.body_ar, input.vars);

  // الحد اليومي لكل تاجر
  if (input.merchantId) {
    const limit = await numSetting(ex, "notifications.daily_limit_per_merchant", 300);
    const sentToday = rowsOf<{ n: number }>(
      await ex.execute(sql`SELECT COUNT(*)::int AS n FROM notification_log WHERE merchant_id = ${input.merchantId}::uuid AND status IN ('sent','simulated') AND created_at::date = now()::date`)
    )[0]!.n;
    if (sentToday >= limit) {
      await logNotif(ex, input, channel, body, "blocked_limit", 0, "تخطّى الحد اليومي");
      return { status: "blocked_limit" };
    }
  }

  const costP = await numSetting(ex, "notifications.cost_per_message_p", 50);
  if (!isWhatsappConfigured()) {
    await logNotif(ex, input, channel, body, "simulated", 0);
    return { status: "simulated", body };
  }
  try {
    await sendWhatsapp(input.toPhone, body);
    await logNotif(ex, input, channel, body, "sent", costP);
    return { status: "sent", body };
  } catch (err) {
    await logNotif(ex, input, channel, body, "failed", 0, err instanceof Error ? err.message : "فشل");
    return { status: "failed" };
  }
}

async function logNotif(ex: SqlExecutor, input: { merchantId: string | null; shipmentId: string | null; toPhone: string; event: string }, channel: string, body: string, status: string, costP: number, error?: string) {
  await ex.execute(sql`
    INSERT INTO notification_log (merchant_id, shipment_id, channel, to_phone, event, body, status, cost_p, error)
    VALUES (${input.merchantId}::uuid, ${input.shipmentId}::uuid, ${channel}, ${input.toPhone}, ${input.event}, ${body}, ${status}, ${costP}, ${error ?? null})`);
}

/** إشعار العميل عند تغيّر الحالة — بيتنده من راوت التحول. */
export async function notifyStatusChange(ex: SqlExecutor, input: { shipmentId: string; event: string }): Promise<SendResult> {
  const s = rowsOf<{ awb: string; recipient_phone: string; merchant_id: string; last_reason_code: string | null; branch_phone: string | null }>(
    await ex.execute(sql`
      SELECT s.awb, s.recipient_phone, s.merchant_id::text, s.last_reason_code,
             (SELECT phone FROM branches WHERE code='MAIN' LIMIT 1) AS branch_phone
      FROM shipments s WHERE s.id = ${input.shipmentId}::uuid`)
  )[0];
  if (!s) return { status: "not_found" };
  return sendNotification(ex, {
    merchantId: s.merchant_id, shipmentId: input.shipmentId, toPhone: s.recipient_phone, event: input.event,
    vars: { awb: s.awb, reason: s.last_reason_code ?? "", phone: s.branch_phone ?? "01040039800", track: `tewsal.online/track/${s.awb}` },
  });
}

/** تقييم العميل بعد التسليم. */
export async function rateDelivery(ex: SqlExecutor, input: { awb: string; stars: number; comment?: string | null }): Promise<{ ok: boolean }> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) throw new HttpError(400, "BAD_STARS", "التقييم من ١ لـ ٥");
  const s = rowsOf<{ id: string; status: string }>(await ex.execute(sql`SELECT id::text, status FROM shipments WHERE awb = ${input.awb} LIMIT 1`))[0];
  if (!s) throw new HttpError(404, "NOT_FOUND", "الشحنة مش موجودة");
  if (s.status !== "delivered" && s.status !== "partially_delivered") throw new HttpError(422, "NOT_DELIVERED", "التقييم بعد التسليم بس");
  await ex.execute(sql`
    INSERT INTO delivery_ratings (shipment_id, stars, comment) VALUES (${s.id}::uuid, ${input.stars}, ${input.comment ?? null})
    ON CONFLICT (shipment_id) DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment`);
  return { ok: true };
}

// ---------------------------------------------------------------
// إدارة القوالب والسجل
// ---------------------------------------------------------------

export async function listTemplates(ex: SqlExecutor) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`SELECT id::text, key, channel, body_ar, is_active FROM notification_templates ORDER BY key`)
  );
}
export async function updateTemplate(ex: SqlExecutor, input: { id: string; bodyAr: string; isActive?: boolean }): Promise<{ ok: boolean }> {
  await ex.execute(sql`UPDATE notification_templates SET body_ar = ${input.bodyAr}, is_active = ${input.isActive ?? true}, updated_at = now() WHERE id = ${input.id}::uuid`);
  return { ok: true };
}
export async function listNotificationLog(ex: SqlExecutor, limit = 100) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT l.event, l.to_phone, l.status, l.cost_p::text AS cost_p, l.body, l.created_at, m.name_ar AS merchant
      FROM notification_log l LEFT JOIN merchants m ON m.id = l.merchant_id
      ORDER BY l.created_at DESC LIMIT ${limit}`)
  );
}
