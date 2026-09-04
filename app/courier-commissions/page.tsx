"use client";

/**
 * عمولات المناديب — قسم المحاسب.
 * المحاسب يختار المندوب → يشوف أوردراته المتسلّمة اللي لسه ماتحاسبش
 * عليها → السيستم **بيقترح** المبلغ لكل أوردر → المحاسب يعدّله ويأكّد
 * → ساعتها بس بيتسجّل القيد (مصروف عمولات / مستحق للمندوب).
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall, toArabicDigits } from "../lib/client";

interface CourierRow { id: string; full_name: string; pending: number }
interface Order { id: string; awb: string; delivered_at: string | null; merchant_name: string | null; cod_amount_p: string }

const FINANCE = ["super_admin", "branch_manager", "accountant"];

function egp(p: string): string {
  const v = BigInt(p || "0");
  return `${(v / 100n).toLocaleString("en-US")}.${(v % 100n).toString().padStart(2, "0")} ج`;
}

export default function CourierCommissionsPage() {
  const user = useCurrentUser();
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [courierId, setCourierId] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadCouriers = useCallback(async () => {
    const r = await apiCall<{ couriers: CourierRow[]; suggestedRateP: string }>("GET", "/api/v1/courier-commissions");
    if (r.ok && r.data) {
      setCouriers(r.data.couriers);
      if (!rate) setRate((Number(r.data.suggestedRateP) / 100).toFixed(2));
    }
  }, [rate]);
  useEffect(() => { if (user) loadCouriers(); }, [user, loadCouriers]);

  const loadOrders = useCallback(async (id: string) => {
    if (!id) { setOrders([]); setPicked(new Set()); return; }
    setLoading(true);
    const r = await apiCall<{ orders: Order[]; suggestedRateP: string }>("GET", `/api/v1/courier-commissions?courierId=${id}`);
    setLoading(false);
    if (r.ok && r.data) {
      setOrders(r.data.orders);
      setPicked(new Set(r.data.orders.map((o) => o.id))); // كلهم متحددين تلقائي
      setRate((Number(r.data.suggestedRateP) / 100).toFixed(2));
    }
  }, []);
  useEffect(() => { if (courierId) loadOrders(courierId); }, [courierId, loadOrders]);

  if (!user) return <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
  const canUse = FINANCE.includes(user.role);

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const rateNum = Number(rate) || 0;
  const total = (rateNum * picked.size).toFixed(2);

  async function submit() {
    setMsg(null);
    if (picked.size === 0) { setMsg({ kind: "err", text: "مفيش أوردرات محددة" }); return; }
    if (rateNum <= 0) { setMsg({ kind: "err", text: "اكتب مبلغ العمولة" }); return; }
    setBusy(true);
    const r = await apiCall<{ code: string; count: number; total: string }>("POST", "/api/v1/courier-commissions", {
      courierId, shipmentIds: [...picked], amountPerOrder: rateNum.toFixed(2), note: note || null,
    });
    setBusy(false);
    if (r.ok && r.data) {
      setMsg({ kind: "ok", text: `اتسجّلت عمولة ${toArabicDigits(r.data.count)} أوردر (${r.data.code}) — إجمالي ${r.data.total}` });
      setNote(""); loadOrders(courierId); loadCouriers();
    } else setMsg({ kind: "err", text: r.error?.message ?? "فشل التسجيل" });
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem" }}>🛵 عمولات المناديب</h2>
        <p style={{ margin: "0 0 1.1rem", color: "var(--muted)", fontSize: "0.83rem", lineHeight: 1.7 }}>
          إنت اللي بتحدد عمولة كل مندوب. السيستم بيقترح مبلغ وإنت تعدّله وتأكّد —
          <b> مفيش عمولة بتتسجّل لوحدها</b>. دي <b>تكلفة على الشركة</b>، مالهاش أي علاقة بالتاجر ولا بحساب الأوردر.
        </p>

        {!canUse ? (
          <div className="card" style={{ padding: "1.5rem", textAlign: "center", color: "var(--muted)" }}>
            الصفحة دي للمحاسب والإدارة بس.
          </div>
        ) : (
          <>
            {msg && (
              <div style={{ marginBottom: "0.9rem", padding: "0.7rem 0.9rem", borderRadius: 12, fontWeight: 700, fontSize: "0.85rem",
                background: msg.kind === "ok" ? "#16a34a18" : "#dc262618",
                border: `1px solid ${msg.kind === "ok" ? "#16a34a33" : "#dc262633"}`,
                color: msg.kind === "ok" ? "var(--color-success)" : "var(--color-danger)" }}>
                {msg.kind === "ok" ? "✅ " : "⚠️ "}{msg.text}
              </div>
            )}

            <div className="card" style={{ padding: "1rem 1.15rem", marginBottom: "1rem" }}>
              <label className="label">المندوب</label>
              <select className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)} style={{ maxWidth: "100%" }}>
                <option value="">— اختار المندوب —</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name} — {c.pending} أوردر لسه ماتحاسبش</option>
                ))}
              </select>
              {couriers.length === 0 && (
                <div style={{ marginTop: 8, fontSize: "0.82rem", color: "var(--muted)" }}>مفيش مناديب عندهم أوردرات مستنية المحاسبة.</div>
              )}
            </div>

            {courierId && (loading ? (
              <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>
            ) : orders.length === 0 ? (
              <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                مفيش أوردرات مستنية المحاسبة للمندوب ده.
              </div>
            ) : (
              <>
                <div className="card" style={{ padding: "1rem 1.15rem", marginBottom: "1rem" }}>
                  <label className="label">العمولة لكل أوردر (ج)</label>
                  <input className="input" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" dir="ltr"
                    style={{ textAlign: "right", maxWidth: 200 }} />
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 4 }}>
                    ده اقتراح من الإعدادات — عدّله زي ما تحب لكل مندوب.
                  </div>
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1.05rem", flexWrap: "wrap", gap: 6 }}>
                    <span>الإجمالي ({toArabicDigits(picked.size)} أوردر × {rate || 0})</span>
                    <span style={{ color: "var(--color-orange-600)" }} dir="ltr">{total} ج</span>
                  </div>
                  <label className="label" style={{ marginTop: 10 }}>ملاحظة (اختياري)</label>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: محاسبة أسبوع ٣/٩" />
                  <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} disabled={busy || picked.size === 0} onClick={submit}>
                    {busy ? "جاري التسجيل..." : `سجّل العمولة (${toArabicDigits(picked.size)} أوردر)`}
                  </button>
                </div>

                <div className="card" style={{ padding: "0.9rem 1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                    <b style={{ fontSize: "0.9rem" }}>الأوردرات ({toArabicDigits(picked.size)}/{toArabicDigits(orders.length)})</b>
                    <button className="btn btn-ghost" style={{ padding: "0.15rem 0.6rem", fontSize: "0.75rem" }}
                      onClick={() => setPicked(picked.size === orders.length ? new Set() : new Set(orders.map((o) => o.id)))}>
                      {picked.size === orders.length ? "إلغاء الكل" : "تحديد الكل"}
                    </button>
                  </div>
                  <div style={{ maxHeight: 340, overflow: "auto" }}>
                    {orders.map((o) => (
                      <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.4rem 0", borderTop: "1px solid var(--border)", fontSize: "0.84rem", cursor: "pointer" }}>
                        <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />
                        <span dir="ltr" style={{ fontWeight: 700, fontSize: "0.76rem" }}>{o.awb}</span>
                        <span style={{ color: "var(--muted)", flex: 1, minWidth: 0 }}>{o.merchant_name ?? "—"}</span>
                        <span style={{ color: "var(--muted)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                          {o.delivered_at ? new Date(o.delivered_at).toLocaleDateString("ar-EG") : "—"}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
