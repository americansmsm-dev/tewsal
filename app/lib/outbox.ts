/**
 * ============================================================
 *  Outbox — طابور التحولات الأوفلاين (مرحلة ي)
 * ------------------------------------------------------------
 *  لما المندوب يعمل تحول والنت مقطوع، بنخزّنه محليًا بـ
 *  device_event_id فريد. أول ما النت يرجع بنعيد إرساله —
 *  والـ idempotency في applyTransition بيمنع أي تكرار.
 * ============================================================
 */
const KEY = "tewsal_outbox_v1";

export interface OutboxItem {
  id: string;
  shipmentId: string;
  body: Record<string, unknown>;
  queuedAt: number;
}

function read(): OutboxItem[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function write(items: OutboxItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ممتلئ/ممنوع */ }
}

export function outboxCount(): number {
  return read().length;
}

/** يضيف تحول للطابور. بيولّد device_event_id لو مش موجود. */
export function queueTransition(shipmentId: string, body: Record<string, unknown>): void {
  const items = read();
  const withId = { ...body, deviceEventId: (body.deviceEventId as string) ?? crypto.randomUUID(), wasOffline: true, source: "pwa" };
  items.push({ id: crypto.randomUUID(), shipmentId, body: withId, queuedAt: Date.now() });
  write(items);
}

/**
 * يعيد إرسال كل عناصر الطابور. النجاح (أو التكرار المطابق 200/201)
 * بيشيل العنصر. فشل الشبكة بيسيبه. بيرجّع كام اتزامن.
 */
export async function flushOutbox(): Promise<number> {
  let items = read();
  if (items.length === 0) return 0;
  let synced = 0;
  const remaining: OutboxItem[] = [];
  for (const it of items) {
    try {
      const res = await fetch(`/api/v1/shipments/${it.shipmentId}/transitions`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify(it.body),
      });
      // النجاح أو التكرار المطابق أو تعارض نهائي (مش قابل لإعادة المحاولة) → نشيله
      if (res.ok || res.status === 409 || res.status === 422 || res.status === 403) synced++;
      else remaining.push(it); // 5xx/شبكة → نحاول تاني
    } catch {
      remaining.push(it); // النت لسه مقطوع
    }
  }
  write(remaining);
  items = remaining;
  return synced;
}
