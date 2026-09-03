"use client";

/**
 * مكوّنات الأوردر المشتركة:
 *  • LabelModal — يعرض البوليصة جوه التطبيق (iframe) + طباعة + رجوع
 *    (بدل ما يفتح تاب جديد يقفل التطبيق في وضع standalone).
 *  • OrderDetailModal — شيت التفاصيل للموبايل، جواه `OrderFullDetails`
 *    (نفس التفاصيل الكاملة اللي بتظهر في كونسول الإدارة) + أزرار الإجراء.
 */
import { OrderFullDetails } from "./OrderFullDetails";


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

// ═══════════════════════ تفاصيل الأوردر (شيت الموبايل) ═══════════════════════
export function OrderDetailModal({
  shipmentId, onClose, onAction, onLabel,
}: {
  shipmentId: string; onClose: () => void;
  onAction?: () => void; onLabel?: () => void;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, maxHeight: "92vh", overflow: "auto",
        background: "var(--surface)", borderRadius: "18px 18px 0 0", padding: "1.1rem 1.15rem 1.4rem",
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: "var(--border)", margin: "0 auto 0.9rem" }} />

        <OrderFullDetails shipmentId={shipmentId} />

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {onAction && <button className="btn btn-primary" style={{ flex: 1 }} onClick={onAction}>تسليم / تعذّر / مرتجع</button>}
          {onLabel && <button className="btn btn-ghost" onClick={onLabel}>🖨️ بوليصة</button>}
          <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}
