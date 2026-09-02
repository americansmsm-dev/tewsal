"use client";

/**
 * نافذة تنفيذ تحول حالة. بتقرا متطلبات التحول (من آلة الحالات)
 * وتعرض الحقول المطلوبة بس: مبلغ التحصيل، سبب التعذّر، ملاحظة،
 * أو اختيار مندوب. بتنده POST /shipments/:id/transitions.
 */
import { useEffect, useRef, useState } from "react";
import { apiCall, uploadProof, type ShipmentStatus } from "../lib/client";
import { queueTransition } from "../lib/outbox";
import {
  STATUS_LABELS_AR,
  allowedTransitions,
  type Role,
} from "@/server/domain/statusMachine";

/** الحالات اللي بيظهر معاها زر صورة الإثبات */
const PHOTO_STATES = new Set<ShipmentStatus>([
  "delivered", "partially_delivered", "delivery_failed", "damaged", "returned_to_merchant",
]);

interface Courier {
  id: string;
  full_name: string;
}
interface ReasonCode {
  code: string;
  name_ar: string;
}
interface Item {
  id: string;
  nameAr: string;
  qty: number;
  unitPriceP: string;
  price: string;
  status: string;
}
/** الحالات اللي بيظهر معاها اختيار القطع (لو الأوردر متقسّم) */
const ITEM_STATES = new Set<ShipmentStatus>(["delivered", "partially_delivered"]);

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
  const [rescheduledAt, setRescheduledAt] = useState(""); // مؤجل لحد (تاريخ)
  const [note, setNote] = useState("");
  const [courierId, setCourierId] = useState("");
  const [receiverName, setReceiverName] = useState("");

  // قطع الأوردر — للتسليم الجزئي بالقطعة
  const [items, setItems] = useState<Item[]>([]);
  const [deliveredIds, setDeliveredIds] = useState<Set<string>>(new Set());
  const useItems = items.length > 0 && !!toStatus && ITEM_STATES.has(toStatus as ShipmentStatus);
  const itemsTotal = items
    .filter((it) => deliveredIds.has(it.id))
    .reduce((s, it) => s + Number(BigInt(it.unitPriceP)) * it.qty, 0) / 100;

  // صورة الإثبات
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = options.find((o) => o.to === toStatus);
  const requires = chosen?.requires ?? [];
  const showPhoto = !!toStatus && PHOTO_STATES.has(toStatus as ShipmentStatus);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoErr(null);
    setPhotoBusy(true);
    try {
      const kind = toStatus === "damaged" ? "damage" : "pod_photo";
      const key = await uploadProof(shipmentId, kind, file);
      setPhotoKey(key);
    } catch (err) {
      setPhotoErr(err instanceof Error ? err.message : "فشل رفع الصورة");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useEffect(() => {
    apiCall<{ couriers: Courier[] }>("GET", "/api/v1/couriers").then((r) =>
      setCouriers(r.data?.couriers ?? [])
    );
    apiCall<{ reasonCodes: ReasonCode[] }>("GET", "/api/v1/reason-codes").then((r) =>
      setReasons(r.data?.reasonCodes ?? [])
    );
    // قطع الأوردر (لو موجودة) — عشان اختيار المتسلّم
    apiCall<{ items: Item[] }>("GET", `/api/v1/shipments/${shipmentId}`).then((r) => {
      const its = r.data?.items ?? [];
      setItems(its);
      setDeliveredIds(new Set(its.map((it) => it.id))); // الافتراضي: الكل اتسلّم
    });
  }, [shipmentId]);

  const isDelivery = toStatus === "delivered" || toStatus === "partially_delivered";

  async function submit() {
    if (!toStatus) return;
    // 📷 صورة إثبات التسليم إجبارية — المندوب مايسلّمش من غير صورة
    if (isDelivery && !photoKey) {
      setError("لازم تصوّر إثبات التسليم قبل ما تسلّم الأوردر 📷");
      return;
    }
    // 🧑‍✈️ خطوات الإسناد لازم تختار مندوب — عشان الشغل ميروحش لحد
    if (needsCourier && !courierId) {
      setError("اختار المندوب الأول عشان الشحنة توصله");
      return;
    }
    setError(null);
    setBusy(true);

    const body: Record<string, unknown> = { to: toStatus, expectedStatus: currentStatus };
    if (useItems) {
      // التسليم بالقطعة: السيرفر بيحسب التحصيل من المتسلّم ويحدّد
      // كلي/جزئي، فبنبعت القطع المتسلّمة + الطريقة بس.
      body.deliveredItemIds = [...deliveredIds];
      body.cod = { collected: itemsTotal.toFixed(2), method: codMethod };
    } else if (requires.includes("cod_amount")) {
      body.cod = { collected: codCollected, method: codMethod };
    }
    if (requires.includes("reason_code")) body.reasonCode = reasonCode;
    if (rescheduledAt && toStatus === "delivery_failed") {
      body.rescheduledAt = new Date(rescheduledAt + "T12:00:00").toISOString();
    }
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
    // صورة الإثبات لو المندوب صوّرها (بتتربط بالشحنة كمرفق)
    if (photoKey) body.photoUrl = photoKey;
    // التوقيع: لو فيه صورة إثبات نستخدمها، وإلا مؤقت لحد ما نعمل لوحة توقيع
    if (requires.includes("signature")) body.signatureUrl = photoKey ?? "pending://signature";
    // idempotency — نفس الحدث مش هيتكرر حتى لو اتزامن أكتر من مرة
    body.deviceEventId = crypto.randomUUID();

    try {
      const r = await apiCall(`POST`, `/api/v1/shipments/${shipmentId}/transitions`, body);
      setBusy(false);
      if (r.ok) onDone();
      else setError(r.error?.message ?? "فشل الإجراء");
    } catch {
      // النت مقطوع — نخزّن التحول ويتزامن لما النت يرجع
      queueTransition(shipmentId, body);
      setBusy(false);
      onDone();
    }
  }

  // كل خطوة بتسنّد شغل لمندوب لازم تعرض اختيار المندوب:
  // استلام · تحميل للتوصيل (run_sheet) · تحميل المرتجع للتاجر (out_for_return)
  const needsCourier =
    !!chosen &&
    (requires.includes("pickup") ||
      requires.includes("run_sheet") ||
      toStatus === "pickup_assigned" ||
      toStatus === "out_for_return");

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

      {/* التسليم بالقطعة — العميل بياخد اللي عايزه، والباقي مرتجع */}
      {useItems && (
        <div style={{ marginBottom: "0.9rem", padding: "0.7rem", background: "var(--bg-soft)", borderRadius: 12 }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: 6 }}>
            🧩 علّم اللي العميل استلمه (الباقي هيترجّع)
          </div>
          {items.map((it) => (
            <label key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.35rem 0", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={deliveredIds.has(it.id)}
                onChange={(e) => setDeliveredIds((prev) => {
                  const n = new Set(prev);
                  if (e.target.checked) n.add(it.id); else n.delete(it.id);
                  return n;
                })}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ flex: 1, fontSize: "0.9rem" }}>
                {it.nameAr} {it.qty > 1 ? `×${it.qty}` : ""}
              </span>
              <span dir="ltr" style={{ fontSize: "0.85rem", fontWeight: 700 }}>{it.price}</span>
            </label>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, flex: 1 }}>
              المحصّل: <span style={{ color: "var(--color-orange-600)" }}>{itemsTotal.toFixed(2)} ج</span>
              {deliveredIds.size < items.length && <span style={{ color: "var(--color-warning)", fontWeight: 700 }}> · تسليم جزئي</span>}
            </span>
            <select className="input" value={codMethod} onChange={(e) => setCodMethod(e.target.value)} style={{ width: 140 }}>
              <option value="cash">كاش</option>
              <option value="vodafone_cash">فودافون كاش</option>
              <option value="instapay">إنستاباي</option>
              <option value="prepaid">مدفوع مقدمًا</option>
            </select>
          </div>
        </div>
      )}

      {!useItems && requires.includes("cod_amount") && (
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
          {/* مؤجل: تاريخ إعادة المحاولة */}
          <div style={{ marginTop: 8 }}>
            <label className="label">مؤجل لحد (اختياري)</label>
            <input
              className="input" type="date" value={rescheduledAt}
              onChange={(e) => setRescheduledAt(e.target.value)}
              min={new Date().toISOString().slice(0, 10)} style={{ width: "100%" }}
            />
            {rescheduledAt && <div style={{ fontSize: "0.75rem", color: "var(--color-warning)", marginTop: 4 }}>هيتسجّل مؤجل لـ {rescheduledAt}</div>}
          </div>
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

      {showPhoto && (
        <div style={{ marginBottom: "0.9rem" }}>
          <label className="label">صورة إثبات {isDelivery || requires.includes("signature") ? "(إجباري)" : "(اختياري)"}</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickPhoto}
            style={{ display: "none" }}
          />
          {photoKey ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 0.8rem", borderRadius: 12, background: "#16a34a18", border: "1px solid #16a34a33" }}>
              <span style={{ fontSize: "1.2rem" }}>✅</span>
              <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: 600, color: "var(--color-success)" }}>الصورة اترفعت</span>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.78rem" }} onClick={() => { setPhotoKey(null); fileRef.current?.click(); }}>تغيير</button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", padding: "0.75rem", fontSize: "0.9rem", borderStyle: "dashed" }}
              disabled={photoBusy}
              onClick={() => fileRef.current?.click()}
            >
              {photoBusy ? "جاري الرفع..." : "📷 التقاط صورة"}
            </button>
          )}
          {photoErr && <div style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--muted)" }}>⚠️ {photoErr}{isDelivery ? " — لازم تعيد المحاولة، الصورة إجبارية" : " — تقدر تكمّل من غير صورة"}</div>}
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
