"use client";

/**
 * BulkPickupModal — «استلام جماعي»: أوردرات التاجر كلها على مندوب واحد بضغطة.
 *
 * الفكرة: تختار التاجر → أوردراته المستنية **بتتحدد كلها تلقائيًا** → تختار
 * المندوب → زرار واحد بيعمل الاستلام ويحمّله على المندوب في **عملية واحدة**
 * (نداء واحد ذرّي: لو الإسناد فشل، الاستلام نفسه مايتعملش).
 *
 * مشترك بين شاشة «الاستلام» والشاشة الرئيسية.
 */
import { useCallback, useEffect, useState } from "react";
import { Overlay, ErrorBox } from "./TransitionModal";
import { apiCall, toArabicDigits } from "../lib/client";

interface MerchantRow { id: string; code: string; name_ar: string; pickup_address: string | null; ready_count: number }
interface Ship { id: string; awb: string; recipient_name: string; governorate: string; cod_amount_p: string }
interface Blocked { id: string; awb: string; pickup_code: string; pickup_status: string }
interface Courier { id: string; full_name: string }

export function BulkPickupModal({
  initialMerchantId, onClose, onDone,
}: {
  /** لو الشاشة فيها فلتر تاجر، بنفتح عليه على طول */
  initialMerchantId?: string | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [merchantId, setMerchantId] = useState(initialMerchantId ?? "");
  const [threshold, setThreshold] = useState(5);
  const [ships, setShips] = useState<Ship[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addr, setAddr] = useState("");
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [courierId, setCourierId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // التجار اللي عندهم شغل + المناديب
  useEffect(() => {
    apiCall<{ merchants: MerchantRow[]; freeThreshold: number }>("GET", "/api/v1/pickups/candidates").then((r) => {
      if (r.ok && r.data) { setMerchants(r.data.merchants); setThreshold(r.data.freeThreshold); }
    });
    apiCall<{ couriers: Courier[] }>("GET", "/api/v1/couriers").then((r) => {
      if (r.ok && r.data) setCouriers(r.data.couriers);
    });
  }, []);

  // أوردرات التاجر المختار — بتتحدد كلها تلقائي
  const loadMerchant = useCallback(async (id: string) => {
    if (!id) { setShips([]); setBlocked([]); setSelected(new Set()); return; }
    setLoading(true); setError(null);
    const r = await apiCall<{
      merchant: { pickup_address: string | null }; shipments: Ship[]; blocked: Blocked[]; freeThreshold: number;
    }>("GET", `/api/v1/pickups/candidates?merchantId=${id}`);
    setLoading(false);
    if (!r.ok || !r.data) { setError(r.error?.message ?? "تعذّر تحميل أوردرات التاجر"); return; }
    setShips(r.data.shipments);
    setBlocked(r.data.blocked);
    setSelected(new Set(r.data.shipments.map((s) => s.id))); // ← تحديد الكل تلقائي
    setThreshold(r.data.freeThreshold);
    setAddr(r.data.merchant.pickup_address ?? ""); // ← العنوان المحفوظ
  }, []);

  useEffect(() => { if (merchantId) loadMerchant(merchantId); }, [merchantId, loadMerchant]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  const allPicked = ships.length > 0 && selected.size === ships.length;

  async function submit() {
    setError(null);
    if (selected.size === 0) { setError("مفيش أوردرات محددة"); return; }
    if (addr.trim().length < 3) { setError("اكتب عنوان الاستلام"); return; }
    setBusy(true);
    const body: Record<string, unknown> = {
      merchantId, shipmentIds: [...selected], pickupAddress: addr.trim(),
    };
    if (courierId) body.courierId = courierId;
    const r = await apiCall<{ code: string; ordersCount: number; serviceFee: string; assigned: number }>(
      "POST", "/api/v1/pickups", body
    );
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.error?.message ?? "فشل الاستلام"); return; }
    const c = couriers.find((x) => x.id === courierId);
    onDone(
      r.data.assigned > 0
        ? `تم استلام ${toArabicDigits(r.data.ordersCount)} أوردر (${r.data.code}) وتحميلهم على ${c?.full_name ?? "المندوب"} — الرسم ${r.data.serviceFee}`
        : `اتعمل طلب استلام ${r.data.code} لـ${toArabicDigits(r.data.ordersCount)} أوردر — الرسم ${r.data.serviceFee} (لسه محتاج إسناد مندوب)`
    );
  }

  const belowFree = selected.size > 0 && selected.size < threshold;

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 2 }}>🚚 استلام جماعي</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 0, marginBottom: 12 }}>
        اختار التاجر — أوردراته المستنية بتتحدد كلها تلقائيًا — واختار مندوب واحد يستلمهم كلهم.
      </p>

      <label className="label">التاجر</label>
      <select className="input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} style={{ marginBottom: 10 }}>
        <option value="">— اختار التاجر —</option>
        {merchants.map((m) => (
          <option key={m.id} value={m.id}>{m.name_ar} ({m.code}) — {m.ready_count} أوردر مستني</option>
        ))}
      </select>

      {loading && <div style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>جاري التحميل...</div>}

      {merchantId && !loading && (
        <>
          {ships.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "0.6rem 0" }}>
              مفيش أوردرات جاهزة للاستلام عند التاجر ده.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <label className="label" style={{ margin: 0 }}>الأوردرات ({toArabicDigits(selected.size)}/{toArabicDigits(ships.length)})</label>
                <button className="btn btn-ghost" style={{ padding: "0.15rem 0.6rem", fontSize: "0.75rem" }}
                  onClick={() => setSelected(allPicked ? new Set() : new Set(ships.map((s) => s.id)))}>
                  {allPicked ? "إلغاء الكل" : "تحديد الكل"}
                </button>
              </div>
              <div style={{ maxHeight: 190, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: "0.4rem 0.6rem", marginBottom: 10 }}>
                {ships.map((s) => (
                  <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.28rem 0", fontSize: "0.84rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                    <span dir="ltr" style={{ fontWeight: 700, fontSize: "0.76rem" }}>{s.awb}</span>
                    <span style={{ color: "var(--muted)" }}>{s.recipient_name} · {s.governorate}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {blocked.length > 0 && (
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 10 }}>
              ⚠️ {toArabicDigits(blocked.length)} أوردر داخل طلب استلام قبل كده ({blocked.map((b) => b.pickup_code).join("، ")}) — مش هيتضموا هنا.
            </div>
          )}

          <label className="label">عنوان الاستلام</label>
          <input className="input" value={addr} onChange={(e) => setAddr(e.target.value)}
            placeholder="عنوان استلام التاجر" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 10 }}>
            بيتعبّى تلقائي من العنوان المحفوظ للتاجر — عدّله لو محتاج.
          </div>

          <label className="label">المندوب</label>
          <select className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)} style={{ marginBottom: 4 }}>
            <option value="">— إسناد لاحقًا —</option>
            {couriers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 10 }}>
            المندوب ده هيستلم كل الأوردرات المحددة مرة واحدة.
          </div>

          {belowFree && (
            <div style={{ fontSize: "0.78rem", color: "var(--color-warning)", fontWeight: 700, marginBottom: 10 }}>
              أقل من {toArabicDigits(threshold)} أوردرات — هيتزاد رسم خدمة استلام ٥٠ ج
            </div>
          )}
        </>
      )}

      {error && <ErrorBox msg={error} />}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || selected.size === 0 || !addr.trim()} onClick={submit}>
          {busy ? "جاري التنفيذ..." : courierId
            ? `استلم وحمّل على المندوب (${toArabicDigits(selected.size)})`
            : `اعمل طلب استلام (${toArabicDigits(selected.size)})`}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
  );
}
