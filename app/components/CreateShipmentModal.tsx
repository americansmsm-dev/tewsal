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

  const [f, setF] = useState({
    merchantId: lockedMerchantId ?? "",
    recipientName: "",
    recipientPhone: "",
    governorateId: "",
    addressLine: "",
    codAmount: "",
    paymentMethod: "cash",
    confirm: true,
  });

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
      confirm: f.confirm,
    };
    if (f.codAmount) body.codAmount = f.codAmount;
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

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem", fontSize: "0.85rem" }}>
        <input type="checkbox" checked={f.confirm} onChange={(e) => set("confirm", e.target.checked)} />
        تأكيد فوري (جاهزة للاستلام)
      </label>

      {error && <ErrorBox msg={error} />}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={busy || !f.merchantId || !f.recipientName || !f.recipientPhone || !f.governorateId || !f.addressLine}
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
