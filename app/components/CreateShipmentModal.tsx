"use client";

/**
 * نافذة إنشاء شحنة. بتجيب التجار والمحافظات، وبتنده
 * POST /api/v1/shipments. السعر بيرجع مثبّت من السيرفر.
 */
import { useEffect, useState } from "react";
import { apiCall } from "../lib/client";
import { Overlay, ErrorBox } from "./TransitionModal";

interface Merchant {
  id: string;
  code: string;
  name_ar: string;
  tier: string;
}
interface Governorate {
  id: string;
  name_ar: string;
  cod_enabled: boolean;
  zone: string;
}

export function CreateShipmentModal({
  onClose,
  onDone,
  lockedMerchantId,
}: {
  onClose: () => void;
  onDone: () => void;
  /** لو محدّد (بوابة التاجر) — التاجر ثابت والقائمة بتختفي */
  lockedMerchantId?: string;
}) {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [govs, setGovs] = useState<Governorate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ awb: string; price: string; totalFees: string } | null>(null);

  const [showMore, setShowMore] = useState(false);
  const [items, setItems] = useState<{ nameAr: string; price: string; qty: string }[]>([]);
  const [lookup, setLookup] = useState<{ blacklisted: boolean; blacklistReason: string | null; total: number; successRate: number; lastNames: string[] } | null>(null);
  const [f, setF] = useState({
    merchantId: lockedMerchantId ?? "",
    recipientName: "",
    recipientPhone: "",
    recipientPhoneAlt: "",
    governorateId: "",
    addressLine: "",
    landmark: "",
    codAmount: "",
    paymentMethod: "cash",
    shippingPayer: "merchant",
    declaredValue: "",
    piecesCount: "1",
    weightKg: "",
    serviceType: "deliver",
    merchantReference: "",
    notesToCourier: "",
    isFragile: false,
    fragileInsured: false,
    confirm: true,
  });

  // لوك-أب العميل الحي — تاريخه + القائمة السوداء
  useEffect(() => {
    const p = f.recipientPhone.replace(/\D/g, "");
    if (p.length < 11) { setLookup(null); return; }
    const t = setTimeout(() => {
      apiCall<typeof lookup>("GET", `/api/v1/customers/lookup?phone=${encodeURIComponent(f.recipientPhone)}`)
        .then((r) => { if (r.ok) setLookup(r.data); });
    }, 400);
    return () => clearTimeout(t);
  }, [f.recipientPhone]);

  useEffect(() => {
    if (!lockedMerchantId) {
      apiCall<{ merchants: Merchant[] }>("GET", "/api/v1/merchants").then((r) =>
        setMerchants(r.data?.merchants ?? [])
      );
    }
    apiCall<{ governorates: Governorate[] }>("GET", "/api/v1/geo/governorates").then((r) =>
      setGovs(r.data?.governorates ?? [])
    );
  }, [lockedMerchantId]);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function submit() {
    setError(null);
    setBusy(true);
    const body: Record<string, unknown> = {
      merchantId: f.merchantId,
      recipientName: f.recipientName,
      recipientPhone: f.recipientPhone,
      governorateId: f.governorateId,
      addressLine: f.addressLine,
      paymentMethod: f.paymentMethod,
      shippingPayer: f.shippingPayer,
      confirm: f.confirm,
    };
    if (f.codAmount) body.codAmount = f.codAmount;
    if (f.recipientPhoneAlt) body.recipientPhoneAlt = f.recipientPhoneAlt;
    if (f.landmark) body.landmark = f.landmark;
    if (f.declaredValue) body.declaredValue = f.declaredValue;
    if (f.piecesCount && f.piecesCount !== "1") body.piecesCount = Number(f.piecesCount);
    if (f.weightKg) body.weightKg = Number(f.weightKg);
    if (f.serviceType !== "deliver") body.serviceType = f.serviceType;
    if (f.merchantReference) body.merchantReference = f.merchantReference;
    if (f.notesToCourier) body.notesToCourier = f.notesToCourier;
    if (f.isFragile) { body.isFragile = true; body.fragileInsured = f.fragileInsured; }
    // قطع الأوردر — لو اتضافت، التحصيل بيتحسب منها في السيرفر
    const validItems = items
      .filter((it) => it.nameAr.trim() && /^\d+(\.\d{1,2})?$/.test(it.price))
      .map((it) => ({ nameAr: it.nameAr.trim(), price: it.price, qty: Number(it.qty) || 1 }));
    if (validItems.length > 0) body.items = validItems;
    const r = await apiCall<{ awb: string; price: string; totalFees: string }>(
      "POST",
      "/api/v1/shipments",
      body
    );
    setBusy(false);
    if (r.ok && r.data) {
      setResult({ awb: r.data.awb, price: r.data.price, totalFees: r.data.totalFees });
    } else {
      setError(r.error?.message ?? "فشل إنشاء الشحنة");
    }
  }

  if (result) {
    return (
      <Overlay onClose={onDone}>
        <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
          <div style={{ fontSize: "2.5rem" }}>✅</div>
          <h3 style={{ margin: "0.5rem 0" }}>اتعملت الشحنة</h3>
          <div
            dir="ltr"
            style={{
              fontSize: "1.3rem",
              fontWeight: 800,
              letterSpacing: "0.04em",
              color: "var(--color-orange-600)",
              margin: "0.5rem 0",
            }}
          >
            {result.awb}
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            الشحن {result.price} · الرسوم {result.totalFees}
          </div>
          <button className="btn btn-primary" style={{ width: "100%", marginTop: "1.25rem" }} onClick={onDone}>
            تمام
          </button>
        </div>
      </Overlay>
    );
  }

  const selectedGov = govs.find((g) => g.id === f.governorateId);

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>شحنة جديدة</h3>

      {!lockedMerchantId && (
        <>
          <label className="label">التاجر</label>
          <select
            className="input"
            value={f.merchantId}
            onChange={(e) => set("merchantId", e.target.value)}
            style={{ marginBottom: "0.8rem" }}
          >
            <option value="">— اختار التاجر —</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name_ar} ({m.code}) — {m.tier}
              </option>
            ))}
          </select>
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: "0.8rem" }}>
        <div style={{ flex: 1 }}>
          <label className="label">اسم المستلم</label>
          <input className="input" value={f.recipientName} onChange={(e) => set("recipientName", e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">تليفون المستلم</label>
          <input
            className="input"
            value={f.recipientPhone}
            onChange={(e) => set("recipientPhone", e.target.value)}
            dir="ltr"
            style={{ textAlign: "right" }}
            placeholder="01xxxxxxxxx"
          />
        </div>
      </div>

      {lookup && lookup.total > 0 && (
        <div style={{
          marginBottom: "0.8rem", padding: "0.55rem 0.8rem", borderRadius: 10, fontSize: "0.8rem", fontWeight: 600,
          background: lookup.blacklisted ? "#dc262618" : "var(--bg-soft)",
          color: lookup.blacklisted ? "var(--color-danger)" : "var(--muted)",
          border: lookup.blacklisted ? "1px solid #dc262633" : "1px solid var(--border)",
        }}>
          {lookup.blacklisted
            ? <>⛔ العميل في القائمة السوداء — {lookup.blacklistReason}</>
            : <>ℹ️ العميل عنده {lookup.total} شحنة · نسبة نجاح {lookup.successRate}%{lookup.lastNames[0] && !f.recipientName ? <> · <button type="button" onClick={() => set("recipientName", lookup.lastNames[0]!)} style={{ background: "none", border: "none", color: "var(--color-orange-600)", cursor: "pointer", fontWeight: 700, padding: 0 }}>استخدم «{lookup.lastNames[0]}»</button></> : null}</>}
        </div>
      )}

      <label className="label">المحافظة</label>
      <select
        className="input"
        value={f.governorateId}
        onChange={(e) => set("governorateId", e.target.value)}
        style={{ marginBottom: "0.8rem" }}
      >
        <option value="">— اختار المحافظة —</option>
        {govs.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name_ar} — {g.zone}
            {g.cod_enabled ? "" : " (بدون تحصيل)"}
          </option>
        ))}
      </select>

      <label className="label">العنوان</label>
      <input
        className="input"
        value={f.addressLine}
        onChange={(e) => set("addressLine", e.target.value)}
        style={{ marginBottom: "0.8rem" }}
      />

      <div style={{ display: "flex", gap: 8, marginBottom: "0.8rem" }}>
        <div style={{ flex: 1 }}>
          <label className="label">مبلغ التحصيل (ج)</label>
          <input
            className="input"
            value={f.codAmount}
            onChange={(e) => set("codAmount", e.target.value)}
            inputMode="decimal"
            dir="ltr"
            style={{ textAlign: "right" }}
            placeholder="0.00"
            disabled={selectedGov ? !selectedGov.cod_enabled : false}
          />
        </div>
        <div style={{ width: 150 }}>
          <label className="label">طريقة الدفع</label>
          <select className="input" value={f.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
            <option value="cash">كاش</option>
            <option value="vodafone_cash">فودافون كاش</option>
            <option value="instapay">إنستاباي</option>
            <option value="prepaid">مدفوع مقدمًا</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: "0.8rem" }}>
        <label className="label">الشحن على مين؟</label>
        <select className="input" value={f.shippingPayer} onChange={(e) => set("shippingPayer", e.target.value)}>
          <option value="merchant">على التاجر (بيتخصم من مستحقاتي)</option>
          <option value="customer">على العميل (بيتضاف على المبلغ اللي بيدفعه)</option>
        </select>
        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4 }}>
          {f.shippingPayer === "customer"
            ? "العميل بيدفع قيمة البضاعة + الشحن."
            : "الشحن بيتخصم من مستحقاتك — أوردر من غير تحصيل بياخد شحنه من محفظتك."}
        </div>
      </div>

      {/* قطع الأوردر — للتسليم الجزئي بالقطعة */}
      <div style={{ padding: "0.8rem", background: "var(--bg-soft)", borderRadius: 12, marginBottom: "0.8rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: items.length ? 8 : 0 }}>
          <b style={{ fontSize: "0.85rem" }}>🧩 تقسيم الأوردر قطع</b>
          <span style={{ fontSize: "0.72rem", color: "var(--muted)", marginInlineEnd: "auto" }}>
            (عشان العميل يقدر يستلم بعضه — التحصيل بيتحسب من القطع)
          </span>
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem" }}
            onClick={() => setItems((p) => [...p, { nameAr: "", price: "", qty: "1" }])}>
            + قطعة
          </button>
        </div>
        {items.map((it, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input className="input" placeholder="اسم القطعة (بنطلون...)" value={it.nameAr}
              onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, nameAr: e.target.value } : x))}
              style={{ flex: 1 }} />
            <input className="input" placeholder="السعر" value={it.price} inputMode="decimal" dir="ltr"
              onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, price: e.target.value } : x))}
              style={{ width: 80, textAlign: "right" }} />
            <input className="input" placeholder="عدد" value={it.qty} inputMode="numeric" dir="ltr"
              onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))}
              style={{ width: 55, textAlign: "right" }} />
            <button type="button" className="btn btn-ghost" style={{ padding: "0 0.5rem", color: "var(--color-danger)" }}
              onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}>✕</button>
          </div>
        ))}
        {items.length > 0 && (
          <div style={{ fontSize: "0.8rem", color: "var(--color-orange-600)", fontWeight: 700, marginTop: 4 }}>
            إجمالي التحصيل من القطع:{" "}
            {(items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (Number(it.qty) || 1), 0)).toFixed(2)} ج
            <span style={{ color: "var(--muted)", fontWeight: 400 }}> — بيتجاهل مبلغ التحصيل فوق</span>
          </div>
        )}
      </div>

      <button type="button" onClick={() => setShowMore((s) => !s)} className="btn btn-ghost" style={{ width: "100%", marginBottom: "0.8rem", fontSize: "0.85rem", justifyContent: "center" }}>
        {showMore ? "▲ إخفاء الخيارات الإضافية" : "▼ خيارات إضافية (وزن، قطع، قابل للكسر، رقم طلب...)"}
      </button>

      {showMore && (
        <div style={{ padding: "0.9rem", background: "var(--bg-soft)", borderRadius: 12, marginBottom: "0.9rem", display: "grid", gap: "0.7rem" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="label">موبايل احتياطي</label>
              <input className="input" value={f.recipientPhoneAlt} onChange={(e) => set("recipientPhoneAlt", e.target.value)} dir="ltr" style={{ textAlign: "right" }} placeholder="01xxxxxxxxx" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">علامة مميزة</label>
              <input className="input" value={f.landmark} onChange={(e) => set("landmark", e.target.value)} placeholder="جنب..." />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="label">عدد القطع</label>
              <input className="input" value={f.piecesCount} onChange={(e) => set("piecesCount", e.target.value)} inputMode="numeric" dir="ltr" style={{ textAlign: "right" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">الوزن (كجم)</label>
              <input className="input" value={f.weightKg} onChange={(e) => set("weightKg", e.target.value)} inputMode="decimal" dir="ltr" style={{ textAlign: "right" }} placeholder="—" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">القيمة المعلنة</label>
              <input className="input" value={f.declaredValue} onChange={(e) => set("declaredValue", e.target.value)} inputMode="decimal" dir="ltr" style={{ textAlign: "right" }} placeholder="—" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="label">نوع الخدمة</label>
              <select className="input" value={f.serviceType} onChange={(e) => set("serviceType", e.target.value)}>
                <option value="deliver">توصيل</option>
                <option value="exchange">استبدال</option>
                <option value="cash_collection">تحصيل فقط</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">رقم الطلب عندك</label>
              <input className="input" value={f.merchantReference} onChange={(e) => set("merchantReference", e.target.value)} placeholder="اختياري" />
            </div>
          </div>
          <div>
            <label className="label">ملاحظة للمندوب</label>
            <input className="input" value={f.notesToCourier} onChange={(e) => set("notesToCourier", e.target.value)} placeholder="اختياري" />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem" }}>
            <input type="checkbox" checked={f.isFragile} onChange={(e) => set("isFragile", e.target.checked)} />
            قابل للكسر
            {f.isFragile && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginInlineStart: 12, color: "var(--muted)" }}>
                <input type="checkbox" checked={f.fragileInsured} onChange={(e) => set("fragileInsured", e.target.checked)} /> مؤمّن
              </label>
            )}
          </label>
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem", fontSize: "0.85rem" }}>
        <input type="checkbox" checked={f.confirm} onChange={(e) => set("confirm", e.target.checked)} />
        تأكيد فوري (جاهزة للاستلام)
      </label>

      {error && <ErrorBox msg={error} />}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={busy || !f.merchantId || !f.recipientName || !f.recipientPhone || !f.governorateId || !f.addressLine || !!lookup?.blacklisted}
          onClick={submit}
        >
          {busy ? "جاري الإنشاء..." : "إنشاء الشحنة"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Overlay>
  );
}
