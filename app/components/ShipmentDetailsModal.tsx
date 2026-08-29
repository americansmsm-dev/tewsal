"use client";

/**
 * تفاصيل الشحنة — الرسوم اليدوية + صور الإثبات.
 * الموظف بيضيف رسوم (تغليف إضافي/تأمين) قبل التسليم، وبيشوف
 * صور الإثبات والتوقيع المرفوعة من المندوب.
 */
import { useCallback, useEffect, useState } from "react";
import { Overlay, ErrorBox } from "./TransitionModal";
import { apiCall } from "../lib/client";

interface Fee {
  id: string;
  fee_code: string;
  description_ar: string;
  amount_p: string;
  amount: string;
  is_estimate: boolean;
  is_auto: boolean;
  voided: boolean;
}
interface Attachment {
  id: string;
  kind: string;
  r2Key: string;
  sizeBytes: number | null;
  uploadedAt: string;
  viewUrl: string | null;
}

/** الرسوم اليدوية على مستوى الشحنة */
const MANUAL_FEES = [
  { code: "EXTRA_PACKAGING", label: "تغليف إضافي" },
  { code: "FRAGILE_INSURANCE", label: "تأمين قابل للكسر" },
];
const KIND_AR: Record<string, string> = {
  pod_photo: "إثبات التسليم",
  signature: "توقيع",
  damage: "تلف",
  id_photo: "بطاقة",
  packaging: "تغليف",
};

/** الحالات النهائية — مايتضافش عليها رسوم (بتترفض من السيرفر) */
const TERMINAL = new Set([
  "delivered", "partially_delivered", "returned_to_merchant",
  "disposed", "lost", "damaged", "cancelled",
]);

export function ShipmentDetailsModal({
  shipmentId, awb, status, canEdit, onClose,
}: {
  shipmentId: string; awb: string; status: string; canEdit: boolean; onClose: () => void;
}) {
  const editable = canEdit && !TERMINAL.has(status);
  const [fees, setFees] = useState<Fee[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [feeCode, setFeeCode] = useState(MANUAL_FEES[0]!.code);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [f, a] = await Promise.all([
      apiCall<{ fees: Fee[] }>("GET", `/api/v1/shipments/${shipmentId}/fees`),
      apiCall<{ attachments: Attachment[] }>("GET", `/api/v1/shipments/${shipmentId}/attachments`),
    ]);
    if (f.ok && f.data) setFees(f.data.fees);
    if (a.ok && a.data) setAttachments(a.data.attachments);
    setLoading(false);
  }, [shipmentId]);
  useEffect(() => { load(); }, [load]);

  async function addFee() {
    setError(null); setBusy(true);
    const r = await apiCall("POST", `/api/v1/shipments/${shipmentId}/fees`, { feeCode, amount });
    setBusy(false);
    if (r.ok) { setAmount(""); load(); } else setError(r.error?.message ?? "فشل");
  }
  async function voidFee(id: string) {
    const reason = window.prompt("سبب إلغاء الرسم؟");
    if (!reason?.trim()) return;
    const r = await apiCall("POST", `/api/v1/shipments/${shipmentId}/fees/${id}/void`, { reason });
    if (r.ok) load(); else setError(r.error?.message ?? "فشل الإلغاء");
  }

  const activeFees = fees.filter((f) => !f.voided);

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>تفاصيل الشحنة</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: 14 }}>
        <span dir="ltr" style={{ fontWeight: 700 }}>{awb}</span>
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", padding: "1rem 0" }}>جاري التحميل...</div>
      ) : (
        <>
          {/* الرسوم */}
          <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 8 }}>الرسوم</div>
          {activeFees.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: "0.83rem", marginBottom: 10 }}>مفيش رسوم مسجّلة</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
              {activeFees.map((f) => (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.45rem 0.7rem", borderRadius: 8, background: "var(--bg-soft)", fontSize: "0.83rem" }}>
                  <span>{f.description_ar}{f.is_estimate && <span style={{ color: "var(--muted)" }}> (تقدير)</span>}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b>{f.amount}</b>
                    {editable && !f.is_auto && !f.is_estimate && (
                      <button onClick={() => voidFee(f.id)} title="إلغاء الرسم" style={{ border: "none", background: "none", color: "var(--color-danger)", cursor: "pointer", fontSize: "0.9rem" }}>✕</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {editable ? (
            <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center" }}>
              <select className="input" value={feeCode} onChange={(e) => setFeeCode(e.target.value)} style={{ flex: 1, padding: "0.4rem 0.5rem", fontSize: "0.82rem" }}>
                {MANUAL_FEES.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
              </select>
              <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" placeholder="ج" style={{ maxWidth: 90, textAlign: "right", padding: "0.4rem 0.5rem" }} />
              <button className="btn btn-primary" style={{ padding: "0.4rem 0.9rem", fontSize: "0.82rem" }} disabled={busy || !amount.trim()} onClick={addFee}>+ رسم</button>
            </div>
          ) : canEdit ? (
            <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginBottom: 16 }}>الشحنة في حالة نهائية — الرسوم بتتضاف قبل التسليم بس</div>
          ) : null}

          {/* صور الإثبات */}
          <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>صور الإثبات</div>
          {attachments.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: "0.83rem" }}>مفيش صور مرفوعة</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {attachments.map((a) => (
                <div key={a.id} style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", width: 92 }}>
                  {a.viewUrl ? (
                    <a href={a.viewUrl} target="_blank" rel="noreferrer" title={KIND_AR[a.kind] ?? a.kind}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.viewUrl} alt={KIND_AR[a.kind] ?? a.kind} style={{ width: 92, height: 92, objectFit: "cover", display: "block" }} />
                    </a>
                  ) : (
                    <div style={{ width: 92, height: 92, display: "grid", placeItems: "center", background: "var(--bg-soft)", fontSize: "1.4rem" }} title="R2 مش متضبط — الصورة مرفوعة بس مفيش رابط عرض">📎</div>
                  )}
                  <div style={{ fontSize: "0.68rem", textAlign: "center", padding: "2px 0", color: "var(--muted)" }}>{KIND_AR[a.kind] ?? a.kind}</div>
                </div>
              ))}
            </div>
          )}

          {error && <div style={{ marginTop: 12 }}><ErrorBox msg={error} /></div>}
          <div style={{ marginTop: 16, textAlign: "left" }}>
            <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
          </div>
        </>
      )}
    </Overlay>
  );
}
