"use client";

/**
 * بوليصة الشحنة — قابلة للطباعة (حراري ١٠×١٥ سم).
 * باركود Code 128 لرقم البوليصة + QR للتتبع.
 * زر الطباعة بيفتح طباعة المتصفح؛ الـ CSS بيضبط المقاس.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiCall, toArabicDigits } from "../../../lib/client";
import { STATUS_LABELS_AR } from "@/server/domain/statusMachine";

interface Shipment {
  awb: string;
  status: string;
  service_type: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_phone_alt: string | null;
  address_line: string;
  landmark: string | null;
  codAmount: string;
  cod_amount_p: string;
  payment_method: string;
  pieces_count: number;
  is_fragile: boolean;
  notes_to_courier: string | null;
  governorate: string;
  area: string | null;
  merchant_name: string | null;
  merchant_code: string | null;
  merchant_phone: string | null;
  merchant_reference: string | null;
  created_at: string;
}

export default function LabelPage() {
  const params = useParams<{ id: string }>();
  const [s, setS] = useState<Shipment | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    apiCall<{ shipment: Shipment }>("GET", `/api/v1/shipments/${params.id}`).then((r) => {
      if (r.ok) setS(r.data!.shipment);
      else setErr(r.error?.message ?? "تعذّر تحميل الشحنة");
    });
  }, [params.id]);

  if (err) return <Center>{err}</Center>;
  if (!s) return <Center>جاري التحميل...</Center>;

  const hasCod = BigInt(s.cod_amount_p || "0") > 0n;
  const barcodeUrl = `/api/v1/barcode?text=${encodeURIComponent(s.awb)}`;
  const qrUrl = `/api/v1/barcode?type=qrcode&text=${encodeURIComponent(`https://tewsal.online/track/${s.awb}`)}`;

  return (
    <>
      <style>{`
        @page { size: 100mm 150mm; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; margin: 0; }
          .label { box-shadow: none !important; margin: 0 !important; }
        }
        .label { color: #000; }
        .label * { box-sizing: border-box; }
      `}</style>

      {/* شريط الأدوات — بيختفي عند الطباعة */}
      <div
        className="no-print"
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          background: "var(--bg-soft)",
          position: "sticky",
          top: 0,
        }}
      >
        <button className="btn btn-primary" onClick={() => window.print()}>
          🖨️ طباعة البوليصة
        </button>
        <button className="btn btn-ghost" onClick={() => window.close()}>
          إغلاق
        </button>
      </div>

      <div style={{ display: "grid", placeItems: "center", padding: "1rem", background: "var(--bg-soft)" }}>
        <div
          className="label"
          style={{
            width: "100mm",
            minHeight: "150mm",
            background: "#fff",
            border: "1px solid #000",
            padding: "4mm",
            fontFamily: "Cairo, sans-serif",
            boxShadow: "0 6px 30px #0003",
          }}
        >
          {/* الهيدر */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #000", paddingBottom: "2mm" }}>
            <div style={{ fontSize: "20px", fontWeight: 800 }}>
              توص<span style={{ color: "#e07b00" }}>ّل</span>
            </div>
            <div style={{ fontSize: "11px", textAlign: "left" }}>
              <div style={{ fontWeight: 700 }}>{serviceLabel(s.service_type)}</div>
              <div>{new Date(s.created_at).toLocaleDateString("ar-EG")}</div>
            </div>
          </div>

          {/* الباركود ورقم البوليصة */}
          <div style={{ textAlign: "center", padding: "2mm 0", borderBottom: "1px dashed #000" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={barcodeUrl} alt={s.awb} style={{ height: "16mm", width: "100%", objectFit: "contain" }} />
            <div dir="ltr" style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "2px", marginTop: "1mm" }}>
              {s.awb}
            </div>
          </div>

          {/* المستلم */}
          <div style={{ padding: "2mm 0", borderBottom: "1px dashed #000" }}>
            <FieldLabel>المُرسَل إليه</FieldLabel>
            <div style={{ fontSize: "16px", fontWeight: 800 }}>{s.recipient_name}</div>
            <div dir="ltr" style={{ fontSize: "15px", fontWeight: 700, textAlign: "right" }}>
              {s.recipient_phone}
              {s.recipient_phone_alt ? ` · ${s.recipient_phone_alt}` : ""}
            </div>
            <div style={{ fontSize: "13px", marginTop: "1mm" }}>
              <b>{s.governorate}</b>
              {s.area ? ` — ${s.area}` : ""}
            </div>
            <div style={{ fontSize: "13px" }}>{s.address_line}</div>
            {s.landmark && <div style={{ fontSize: "12px", color: "#333" }}>علامة: {s.landmark}</div>}
          </div>

          {/* التحصيل */}
          <div style={{ display: "flex", alignItems: "stretch", padding: "2mm 0", borderBottom: "1px dashed #000", gap: "3mm" }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>المبلغ المطلوب تحصيله</FieldLabel>
              {hasCod ? (
                <div style={{ fontSize: "26px", fontWeight: 800 }}>{s.codAmount}</div>
              ) : (
                <div style={{ fontSize: "16px", fontWeight: 700 }}>مدفوع مقدمًا</div>
              )}
              <div style={{ fontSize: "11px" }}>طريقة الدفع: {methodLabel(s.payment_method)}</div>
            </div>
            {/* QR للتتبع */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="تتبع" style={{ width: "24mm", height: "24mm" }} />
          </div>

          {/* تفاصيل الطرد */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "2mm 0", fontSize: "12px", borderBottom: "1px dashed #000" }}>
            <span>عدد القطع: <b>{toArabicDigits(s.pieces_count)}</b></span>
            {s.is_fragile && <span style={{ fontWeight: 800, border: "1px solid #000", padding: "0 2mm", borderRadius: "2mm" }}>⚠ قابل للكسر</span>}
            <span>{STATUS_LABELS_AR[s.status as never] ?? s.status}</span>
          </div>

          {s.notes_to_courier && (
            <div style={{ padding: "1.5mm 0", fontSize: "11px", borderBottom: "1px dashed #000" }}>
              <b>ملاحظات:</b> {s.notes_to_courier}
            </div>
          )}

          {/* المرسِل */}
          <div style={{ padding: "2mm 0", fontSize: "11px" }}>
            <FieldLabel>المُرسِل (التاجر)</FieldLabel>
            <div>
              <b>{s.merchant_name ?? "—"}</b>
              {s.merchant_code ? ` (${s.merchant_code})` : ""}
              {s.merchant_reference ? ` · مرجع: ${s.merchant_reference}` : ""}
            </div>
          </div>

          <div style={{ textAlign: "center", fontSize: "10px", color: "#333", borderTop: "1px solid #000", paddingTop: "1.5mm" }}>
            توصّل للشحن · {origin.replace(/^https?:\/\//, "")} · تتبع شحنتك من كود QR
          </div>
        </div>
      </div>
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "10px", color: "#555", fontWeight: 700 }}>{children}</div>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>{children}</div>;
}
function serviceLabel(t: string): string {
  return t === "return" ? "بوليصة إرجاع" : t === "exchange" ? "بوليصة استبدال" : "بوليصة شحن";
}
function methodLabel(m: string): string {
  return { cash: "كاش", vodafone_cash: "فودافون كاش", instapay: "إنستاباي", prepaid: "مدفوع مقدمًا" }[m] ?? m;
}
