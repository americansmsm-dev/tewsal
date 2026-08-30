"use client";

/**
 * مكوّنات الأوردر المشتركة:
 *  • LabelModal — يعرض البوليصة جوه التطبيق (iframe) + طباعة + رجوع
 *    (بدل ما يفتح تاب جديد يقفل التطبيق في وضع standalone).
 *  • OrderDetailModal — تفاصيل الأوردر كاملة بشكل نضيف وسريع.
 */
import { useEffect, useState } from "react";
import { apiCall, STATUS_LABELS_AR, statusTone, toneStyle, type ShipmentStatus } from "../lib/client";

// ═══════════════════════ البوليصة ═══════════════════════
export function LabelModal({ shipmentId, onClose }: { shipmentId: string; onClose: () => void }) {
  function print() {
    const f = document.getElementById("labelFrame") as HTMLIFrameElement | null;
    try { f?.contentWindow?.focus(); f?.contentWindow?.print(); } catch { /* تجاهل */ }
  }
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", flexDirection: "column", background: "var(--surface)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)" }}>
        <b style={{ flex: 1 }}>البوليصة</b>
        <button className="btn btn-ghost" onClick={print}>🖨️ طباعة</button>
        <button className="btn btn-primary" onClick={onClose}>← رجوع</button>
      </div>
      <iframe id="labelFrame" src={`/shipments/${shipmentId}/label`} title="البوليصة" style={{ flex: 1, border: 0, background: "#fff", width: "100%" }} />
    </div>
  );
}

// ═══════════════════════ تفاصيل الأوردر ═══════════════════════
interface Detail {
  shipment: Record<string, unknown> & { codAmount: string };
  items: { id: string; nameAr: string; qty: number; price: string; status: string }[];
}
const ITEM_STATUS_AR: Record<string, string> = { pending: "لسه", delivered: "اتسلّم", returned: "رجع" };

export function OrderDetailModal({
  shipmentId, onClose, onAction, onLabel,
}: {
  shipmentId: string; onClose: () => void;
  onAction?: () => void; onLabel?: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiCall<Detail>("GET", `/api/v1/shipments/${shipmentId}`).then((r) => {
      if (r.ok) setD(r.data); else setErr(r.error?.message ?? "تعذّر تحميل التفاصيل");
    });
  }, [shipmentId]);

  const s = d?.shipment;
  const status = (s?.status as ShipmentStatus) ?? "draft";
  const phone = s?.recipient_phone as string | undefined;
  const resched = s?.rescheduled_at ? new Date(s.rescheduled_at as string) : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, maxHeight: "92vh", overflow: "auto",
        background: "var(--surface)", borderRadius: "18px 18px 0 0", padding: "1.1rem 1.15rem 1.4rem",
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: "var(--border)", margin: "0 auto 0.9rem" }} />
        {err ? (
          <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--color-danger)" }}>{err}</div>
        ) : !s ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{s.recipient_name as string}</div>
                <div dir="ltr" style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>{s.awb as string}</div>
              </div>
              <span className="badge" style={{ ...toneStyle(statusTone(status)), whiteSpace: "nowrap" }}>{STATUS_LABELS_AR[status]}</span>
            </div>

            {/* التحصيل */}
            <div style={{ textAlign: "center", padding: "0.8rem", background: "var(--bg-soft)", borderRadius: 12, marginBottom: 12 }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{BigInt((s.cod_amount_p as string) || "0") > 0n ? "المطلوب تحصيله" : "بدون تحصيل"}</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "var(--color-orange-600)" }}>{s.codAmount}</div>
            </div>

            {resched && (
              <Row label="⏰ مؤجل لحد" value={resched.toLocaleDateString("ar-EG", { day: "numeric", month: "long" })} tone="warn" />
            )}
            <Row label="📍 العنوان" value={`${s.governorate as string}${s.area ? " · " + (s.area as string) : ""} — ${s.address_line as string}`} />
            {s.landmark ? <Row label="علامة مميزة" value={s.landmark as string} /> : null}
            <Row label="📞 الموبايل" value={<a href={`tel:${phone}`} dir="ltr" style={{ color: "var(--color-orange-600)", fontWeight: 700 }}>{phone}</a>} />
            {s.recipient_phone_alt ? <Row label="موبايل احتياطي" value={<span dir="ltr">{s.recipient_phone_alt as string}</span>} /> : null}
            <Row label="القطع" value={`${s.pieces_count as number} قطعة`} />
            {s.merchant_reference ? <Row label="رقم أوردر التاجر" value={s.merchant_reference as string} /> : null}
            {s.notes_to_courier ? <Row label="📝 ملاحظة للمندوب" value={s.notes_to_courier as string} /> : null}
            {s.is_fragile ? <Row label="⚠️ قابل للكسر" value={s.fragile_insured ? "مؤمّن" : "غير مؤمّن"} tone="warn" /> : null}

            {/* قطع الأوردر */}
            {d.items.length > 0 && (
              <div style={{ marginTop: 10, marginBottom: 6 }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: 6 }}>🧩 محتويات الأوردر</div>
                {d.items.map((it) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", borderTop: "1px solid var(--border)", fontSize: "0.88rem" }}>
                    <span>{it.nameAr} {it.qty > 1 ? `×${it.qty}` : ""}</span>
                    <span style={{ display: "flex", gap: 10 }}>
                      <span style={{ color: "var(--muted)" }}>{ITEM_STATUS_AR[it.status] ?? it.status}</span>
                      <b dir="ltr">{it.price}</b>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* أزرار */}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {onAction && <button className="btn btn-primary" style={{ flex: 1 }} onClick={onAction}>تسليم / تعذّر / مرتجع</button>}
              {onLabel && <button className="btn btn-ghost" onClick={onLabel}>🖨️ بوليصة</button>}
              <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "0.45rem 0", borderTop: "1px solid var(--border)" }}>
      <span style={{ fontSize: "0.8rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: 600, textAlign: "left", color: tone === "warn" ? "var(--color-warning)" : "var(--ink)" }}>{value}</span>
    </div>
  );
}
