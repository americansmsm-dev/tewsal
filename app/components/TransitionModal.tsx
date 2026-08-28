"use client";

/**
 * نافذة تنفيذ تحول حالة. بتقرا متطلبات التحول (من آلة الحالات)
 * وتعرض الحقول المطلوبة بس: مبلغ التحصيل، سبب التعذّر، ملاحظة،
 * أو اختيار مندوب. بتنده POST /shipments/:id/transitions.
 */
import { useEffect, useState } from "react";
import { apiCall, type ShipmentStatus } from "../lib/client";
import {
  STATUS_LABELS_AR,
  allowedTransitions,
  type Role,
} from "@/server/domain/statusMachine";

interface Courier {
  id: string;
  full_name: string;
}
interface ReasonCode {
  code: string;
  name_ar: string;
}

export function TransitionModal({
  shipmentId,
  awb,
  currentStatus,
  currentCourierId,
  role,
  onClose,
  onDone,
}: {
  shipmentId: string;
  awb: string;
  currentStatus: ShipmentStatus;
  currentCourierId: string | null;
  role: Role;
  onClose: () => void;
  onDone: () => void;
}) {
  const options = allowedTransitions(currentStatus, role);
  const [toStatus, setToStatus] = useState<ShipmentStatus | "">("");
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // الحقول
  const [codCollected, setCodCollected] = useState("");
  const [codMethod, setCodMethod] = useState("cash");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [courierId, setCourierId] = useState("");
  const [receiverName, setReceiverName] = useState("");

  const chosen = options.find((o) => o.to === toStatus);
  const requires = chosen?.requires ?? [];

  useEffect(() => {
    apiCall<{ couriers: Courier[] }>("GET", "/api/v1/couriers").then((r) =>
      setCouriers(r.data?.couriers ?? [])
    );
    apiCall<{ reasonCodes: ReasonCode[] }>("GET", "/api/v1/reason-codes").then((r) =>
      setReasons(r.data?.reasonCodes ?? [])
    );
  }, []);

  async function submit() {
    if (!toStatus) return;
    setError(null);
    setBusy(true);

    const body: Record<string, unknown> = { to: toStatus, expectedStatus: currentStatus };
    if (requires.includes("cod_amount")) body.cod = { collected: codCollected, method: codMethod };
    if (requires.includes("reason_code")) body.reasonCode = reasonCode;
    if (note) body.note = note;
    if (receiverName) body.receiverName = receiverName;
    // متطلبات الإسناد/التحميل — بنولّد مرجع مؤقت للبيك أب/الكشف
    if (requires.includes("pickup")) body.pickupId = crypto.randomUUID();
    if (requires.includes("run_sheet")) body.runSheetId = crypto.randomUUID();
    if (courierId) {
      body.courierId = courierId;
    } else if (currentCourierId && requires.includes("cod_amount")) {
      body.expectedCourierId = currentCourierId;
    }
    if (requires.includes("signature")) body.signatureUrl = "pending://signature";

    const r = await apiCall(`POST`, `/api/v1/shipments/${shipmentId}/transitions`, body);
    setBusy(false);
    if (r.ok) {
      onDone();
    } else {
      setError(r.error?.message ?? "فشل الإجراء");
    }
  }

  const needsCourier =
    !!chosen &&
    (requires.includes("pickup") || requires.includes("run_sheet") || toStatus === "pickup_assigned");

  return (
    <Overlay onClose={onClose}>
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>تنفيذ إجراء</div>
        <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>
          البوليصة <span dir="ltr">{awb}</span>
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>
          الحالة: {STATUS_LABELS_AR[currentStatus]}
        </div>
      </div>

      <label className="label">الإجراء</label>
      <select
        className="input"
        value={toStatus}
        onChange={(e) => setToStatus(e.target.value as ShipmentStatus)}
        style={{ marginBottom: "0.9rem" }}
      >
        <option value="">— اختار —</option>
        {options.map((o) => (
          <option key={o.to} value={o.to}>
            {o.label}
          </option>
        ))}
      </select>

      {requires.includes("cod_amount") && (
        <div style={{ display: "flex", gap: 8, marginBottom: "0.9rem" }}>
          <div style={{ flex: 1 }}>
            <label className="label">المبلغ المحصّل (ج)</label>
            <input
              className="input"
              value={codCollected}
              onChange={(e) => setCodCollected(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              style={{ textAlign: "right" }}
              placeholder="0.00"
            />
          </div>
          <div style={{ width: 140 }}>
            <label className="label">الطريقة</label>
            <select className="input" value={codMethod} onChange={(e) => setCodMethod(e.target.value)}>
              <option value="cash">كاش</option>
              <option value="vodafone_cash">فودافون كاش</option>
              <option value="instapay">إنستاباي</option>
              <option value="prepaid">مدفوع مقدمًا</option>
            </select>
          </div>
        </div>
      )}

      {requires.includes("reason_code") && (
        <div style={{ marginBottom: "0.9rem" }}>
          <label className="label">سبب التعذّر</label>
          <select className="input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
            <option value="">— اختار السبب —</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name_ar}
              </option>
            ))}
          </select>
        </div>
      )}

      {requires.includes("receiver_name") && (
        <div style={{ marginBottom: "0.9rem" }}>
          <label className="label">اسم المستلم</label>
          <input className="input" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
        </div>
      )}

      {needsCourier && (
        <div style={{ marginBottom: "0.9rem" }}>
          <label className="label">المندوب</label>
          <select className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)}>
            <option value="">— اختار المندوب —</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {(requires.includes("note") || !requires.length) && toStatus && (
        <div style={{ marginBottom: "0.9rem" }}>
          <label className="label">
            ملاحظة {requires.includes("note") ? "(إجبارية)" : "(اختيارية)"}
          </label>
          <textarea
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
        </div>
      )}

      {error && <ErrorBox msg={error} />}

      <div style={{ display: "flex", gap: 8, marginTop: "0.5rem" }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={!toStatus || busy} onClick={submit}>
          {busy ? "جاري..." : "تنفيذ"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Overlay>
  );
}

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "#0008",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 460, padding: "1.5rem", maxHeight: "90vh", overflow: "auto" }}
      >
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ msg }: { msg: string }) {
  return (
    <div
      style={{
        background: "#dc262618",
        color: "var(--color-danger)",
        border: "1px solid #dc262633",
        borderRadius: 12,
        padding: "0.6rem 0.85rem",
        fontSize: "0.85rem",
        marginBottom: "0.9rem",
        fontWeight: 600,
      }}
    >
      {msg}
    </div>
  );
}
