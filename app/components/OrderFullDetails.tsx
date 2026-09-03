"use client";

/**
 * OrderFullDetails — **تفاصيل الأوردر كاملة** في أي خطوة وأي شاشة.
 * بيجيب كل بيانات الشحنة (فلوس · تاجر · مستلم · عنوان · شحنة ·
 * مواعيد · مندوب · قطع) + **خط زمني بكل خطوة** عدّى بيها (مين ومتى وليه).
 *
 * مشترك بين: تطبيق المندوب، بوابة التاجر، وكونسول الإدارة — عشان
 * كل الأدوار تشوف نفس التفاصيل الكاملة.
 */
import { useEffect, useState } from "react";
import { apiCall, STATUS_LABELS_AR, statusTone, toneStyle, type ShipmentStatus } from "../lib/client";

export interface Step {
  from_status: string | null; to_status: string; reason_code: string | null; reason_label: string | null;
  note: string | null; actor_name: string | null; actor_role: string | null;
  occurred_at: string; source: string | null;
}
export interface Detail {
  shipment: Record<string, unknown> & { codAmount: string; priceAmount: string; feesAmount: string; netAmount: string; goodsAmount: string; withShippingAmount: string; customerPaysShipping: boolean };
  items: { id: string; nameAr: string; sku: string | null; qty: number; price: string; status: string }[];
  history: Step[];
}

const ITEM_STATUS_AR: Record<string, string> = { pending: "لسه", delivered: "اتسلّم", returned: "رجع" };
const ROLE_AR: Record<string, string> = {
  super_admin: "مدير النظام", branch_manager: "مدير الفرع", ops: "العمليات",
  courier: "مندوب", merchant: "تاجر", accountant: "محاسب", support: "خدمة العملاء",
};
const PAYER_AR: Record<string, string> = { merchant: "على التاجر", customer: "على العميل" };
const METHOD_AR: Record<string, string> = {
  cash: "كاش", vodafone_cash: "فودافون كاش", instapay: "إنستاباي", prepaid: "مدفوع مقدمًا", card: "فيزا",
};
const SERVICE_AR: Record<string, string> = {
  deliver: "توصيل", exchange: "استبدال", cash_collection: "تحصيل نقدي", return_only: "إرجاع",
};

/** تاريخ + وقت بالعربي */
function dt(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function OrderFullDetails({ shipmentId, showHeader = true }: { shipmentId: string; showHeader?: boolean }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiCall<Detail>("GET", `/api/v1/shipments/${shipmentId}`).then((r) => {
      if (r.ok) setD(r.data); else setErr(r.error?.message ?? "تعذّر تحميل التفاصيل");
    });
  }, [shipmentId]);

  if (err) return <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--color-danger)" }}>{err}</div>;
  if (!d?.shipment) return <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  const s = d.shipment;
  const status = (s.status as ShipmentStatus) ?? "draft";
  const phone = s.recipient_phone as string | undefined;
  const str = (k: string) => (s[k] as string | null) || null;

  return (
    <>
      {showHeader && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{s.recipient_name as string}</div>
            <div dir="ltr" style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>{s.awb as string}</div>
          </div>
          <span className="badge" style={{ ...toneStyle(statusTone(status)), whiteSpace: "nowrap" }}>{STATUS_LABELS_AR[status]}</span>
        </div>
      )}

      {/* التحصيل */}
      <div style={{ textAlign: "center", padding: "0.8rem", background: "var(--bg-soft)", borderRadius: 12, marginBottom: 4 }}>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{BigInt((s.cod_amount_p as string) || "0") > 0n ? "المطلوب تحصيله" : "بدون تحصيل"}</div>
        <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "var(--color-orange-600)" }}>{s.codAmount}</div>
      </div>

      {/* الفلوس */}
      <Section title="💰 الفلوس" />
      <Row label="🛍️ سعر الأوردر (من غير شحن)" value={s.goodsAmount} />
      <Row label="🚚 الشحن لوحده" value={s.priceAmount} />
      <Row label="🧾 الإجمالي بالشحن" value={s.withShippingAmount} />
      <Row label="إجمالي الرسوم (شامل الشحن)" value={s.feesAmount} />
      <Row label="💵 صافي التاجر (بعد خصم الرسوم)" value={s.netAmount} />
      <Row label="الشحن على مين" value={PAYER_AR[str("shipping_payer") ?? ""] ?? (str("shipping_payer") ?? "—")} />
      <Row label="طريقة الدفع" value={METHOD_AR[str("payment_method") ?? ""] ?? (str("payment_method") ?? "—")} />
      {s.is_wallet_order ? <Row label="من المحفظة" value="أيوه — الشحن بيتخصم من محفظة التاجر" tone="warn" /> : null}

      {/* التاجر */}
      <Section title="🏪 التاجر" />
      <Row label="📄 اسم البيدج" value={str("merchant_name") ?? "—"} />
      {str("merchant_code") ? <Row label="كود التاجر" value={str("merchant_code")} /> : null}
      {str("merchant_phone") ? <Row label="موبايل التاجر" value={<a href={`tel:${str("merchant_phone")}`} dir="ltr" style={{ color: "var(--color-orange-600)", fontWeight: 700 }}>{str("merchant_phone")}</a>} /> : null}
      {str("merchant_reference") ? <Row label="رقم أوردر التاجر" value={str("merchant_reference")} /> : null}

      {/* المستلم والعنوان */}
      <Section title="📍 المستلم والعنوان" />
      <Row label="اسم المستلم" value={s.recipient_name as string} />
      <Row label="الموبايل" value={<a href={`tel:${phone}`} dir="ltr" style={{ color: "var(--color-orange-600)", fontWeight: 700 }}>{phone}</a>} />
      {str("recipient_phone_alt") ? <Row label="موبايل احتياطي" value={<a href={`tel:${str("recipient_phone_alt")}`} dir="ltr">{str("recipient_phone_alt")}</a>} /> : null}
      <Row label="المنطقة" value={`${str("zone") ?? "—"} · ${str("governorate") ?? "—"}${s.area ? " · " + (s.area as string) : ""}`} />
      <Row label="العنوان" value={str("address_line") ?? "—"} />
      {str("landmark") ? <Row label="علامة مميزة" value={str("landmark")} /> : null}

      {/* الشحنة */}
      <Section title="📦 الشحنة" />
      <Row label="نوع الخدمة" value={SERVICE_AR[str("service_type") ?? ""] ?? (str("service_type") ?? "—")} />
      <Row label="عدد القطع" value={`${s.pieces_count as number} قطعة`} />
      {s.weight_registered_kg ? <Row label="الوزن المسجّل" value={`${s.weight_registered_kg} كجم`} /> : null}
      {s.weight_actual_kg ? <Row label="الوزن الفعلي" value={`${s.weight_actual_kg} كجم`} /> : null}
      <Row label="عدد المحاولات" value={`${(s.attempts_count as number) ?? 0}`} />
      {s.is_fragile ? <Row label="⚠️ قابل للكسر" value={s.fragile_insured ? "مؤمّن" : "غير مؤمّن"} tone="warn" /> : null}
      {str("notes_to_courier") ? <Row label="📝 ملاحظة للمندوب" value={str("notes_to_courier")} /> : null}

      {/* المندوب والمواعيد */}
      <Section title="🛵 المندوب والمواعيد" />
      <Row label="المندوب الحالي" value={str("courier_name") ?? "مفيش"} />
      {str("courier_phone") ? <Row label="موبايل المندوب" value={<a href={`tel:${str("courier_phone")}`} dir="ltr">{str("courier_phone")}</a>} /> : null}
      <Row label="اتعمل في" value={dt(s.created_at) ?? "—"} />
      {dt(s.promised_at) ? <Row label="⏳ الموعد المتوقع" value={dt(s.promised_at)} /> : null}
      {dt(s.rescheduled_at) ? <Row label="⏰ مؤجل لحد" value={dt(s.rescheduled_at)} tone="warn" /> : null}
      {dt(s.delivered_at) ? <Row label="✅ اتسلّم في" value={dt(s.delivered_at)} /> : null}

      {/* قطع الأوردر */}
      {d.items.length > 0 && (
        <>
          <Section title="🧩 محتويات الأوردر" />
          {d.items.map((it) => (
            <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", borderTop: "1px solid var(--border)", fontSize: "0.88rem" }}>
              <span>{it.nameAr}{it.qty > 1 ? ` ×${it.qty}` : ""}{it.sku ? <span style={{ color: "var(--muted)", fontSize: "0.75rem" }} dir="ltr"> {it.sku}</span> : null}</span>
              <span style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "var(--muted)" }}>{ITEM_STATUS_AR[it.status] ?? it.status}</span>
                <b dir="ltr">{it.price}</b>
              </span>
            </div>
          ))}
        </>
      )}

      {/* خط زمني: كل خطوة */}
      <Section title="📜 كل خطوة عدّى بيها الأوردر" />
      {d.history.length === 0 ? (
        <div style={{ padding: "0.6rem 0", color: "var(--muted)", fontSize: "0.82rem" }}>مفيش خطوات مسجّلة</div>
      ) : (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          {d.history.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 8, paddingBottom: 10 }}>
              <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: "var(--color-orange-500)", marginTop: 5 }} />
                {i < d.history.length - 1 && <span style={{ flex: 1, width: 2, background: "var(--border)" }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>
                  {STATUS_LABELS_AR[h.to_status as ShipmentStatus] ?? h.to_status}
                  {h.from_status && <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: "0.76rem" }}> (من {STATUS_LABELS_AR[h.from_status as ShipmentStatus] ?? h.from_status})</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  {dt(h.occurred_at) ?? "—"}
                  {h.actor_name ? ` · ${h.actor_name}` : ""}
                  {h.actor_role ? ` (${ROLE_AR[h.actor_role] ?? h.actor_role})` : ""}
                </div>
                {(h.reason_label || h.reason_code) && (
                  <div style={{ fontSize: "0.78rem", color: "var(--color-warning)", fontWeight: 600 }}>السبب: {h.reason_label ?? h.reason_code}</div>
                )}
                {h.note && <div style={{ fontSize: "0.78rem" }}>📝 {h.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Section({ title }: { title: string }) {
  return <div style={{ fontSize: "0.82rem", fontWeight: 800, marginTop: 14, marginBottom: 2, color: "var(--color-orange-600)" }}>{title}</div>;
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "0.45rem 0", borderTop: "1px solid var(--border)" }}>
      <span style={{ fontSize: "0.8rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: 600, textAlign: "left", color: tone === "warn" ? "var(--color-warning)" : "var(--ink)" }}>{value}</span>
    </div>
  );
}
