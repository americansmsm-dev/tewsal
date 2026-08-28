"use client";

/**
 * شاشة الاستلام (العمليات) — قائمة طلبات الاستلام + إنشاء +
 * إسناد لمندوب + تأكيد. أقل من ٥ أوردرات بيتزاد عليها ٥٠ ج.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface Pickup {
  id: string;
  code: string;
  status: string;
  orders_count: number;
  service_fee_p: string;
  pickup_address: string;
  merchant_name: string;
  merchant_code: string;
  courier_name: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  requested: "طلب جديد",
  assigned: "مسند لمندوب",
  collected: "تم الاستلام",
  cancelled: "ملغي",
};
const STATUS_COLOR: Record<string, string> = {
  requested: "var(--color-warning)",
  assigned: "#2563eb",
  collected: "var(--color-success)",
  cancelled: "var(--muted)",
};

function egp(p: string): string {
  const v = BigInt(p || "0");
  return `${(v / 100n).toString()}.${(v % 100n).toString().padStart(2, "0")} ج`;
}

export default function PickupsPage() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<Pickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [assignFor, setAssignFor] = useState<Pickup | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiCall<{ pickups: Pickup[] }>("GET", "/api/v1/pickups");
    if (r.ok) setRows(r.data?.pickups ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function confirm(p: Pickup) {
    setMsg(null);
    const r = await apiCall<{ collected: number; feeCharged: boolean }>("POST", `/api/v1/pickups/${p.id}/confirm`);
    if (r.ok) {
      setMsg(`تم استلام ${p.code} — ${r.data?.collected} شحنة${r.data?.feeCharged ? " · اتحاسب رسم ٥٠ ج" : ""}`);
      load();
    } else {
      setMsg(r.error?.message ?? "فشل التأكيد");
    }
  }

  if (!user) return <Loading />;
  const canCreate = ["super_admin", "branch_manager", "ops"].includes(user.role);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1050, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", marginInlineEnd: "auto" }}>الاستلام من التجار</h2>
          {canCreate && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ طلب استلام</button>}
        </div>

        {msg && (
          <div style={{ marginBottom: 12, padding: "0.6rem 0.9rem", borderRadius: 10, background: "var(--bg-soft)", border: "1px solid var(--border)", fontSize: "0.88rem", fontWeight: 600 }}>
            {msg}
          </div>
        )}

        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>الكود</Th><Th>التاجر</Th><Th>الأوردرات</Th><Th>رسم الخدمة</Th><Th>المندوب</Th><Th>الحالة</Th><Th>إجراء</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش طلبات استلام لسه</td></tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td><span dir="ltr" style={{ fontWeight: 700 }}>{p.code}</span></Td>
                    <Td>{p.merchant_name}</Td>
                    <Td>{p.orders_count}</Td>
                    <Td>{BigInt(p.service_fee_p || "0") > 0n ? <b style={{ color: "var(--color-warning)" }}>{egp(p.service_fee_p)}</b> : <span style={{ color: "var(--muted)" }}>مجاني</span>}</Td>
                    <Td>{p.courier_name ?? <span style={{ color: "var(--muted)" }}>—</span>}</Td>
                    <Td><span className="badge" style={{ color: STATUS_COLOR[p.status] }}>{STATUS_LABEL[p.status] ?? p.status}</span></Td>
                    <Td>
                      {p.status === "requested" ? (
                        <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => setAssignFor(p)}>إسناد لمندوب</button>
                      ) : p.status === "assigned" ? (
                        <button className="btn btn-primary" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => confirm(p)}>تأكيد الاستلام</button>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>—</span>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {showCreate && <CreatePickupModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
      {assignFor && <AssignModal pickup={assignFor} onClose={() => setAssignFor(null)} onDone={() => { setAssignFor(null); load(); }} />}
    </div>
  );
}

function CreatePickupModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [merchants, setMerchants] = useState<{ id: string; name_ar: string; code: string }[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [shipments, setShipments] = useState<{ id: string; awb: string; recipient_name: string; governorate: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiCall<{ merchants: typeof merchants }>("GET", "/api/v1/merchants").then((r) => setMerchants(r.data?.merchants ?? []));
  }, []);

  useEffect(() => {
    setSelected(new Set());
    if (!merchantId) { setShipments([]); return; }
    apiCall<{ shipments: typeof shipments }>("GET", `/api/v1/shipments?merchantId=${merchantId}&status=awaiting_pickup&limit=200`)
      .then((r) => setShipments(r.data?.shipments ?? []));
  }, [merchantId]);

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function submit() {
    setError(null); setBusy(true);
    const r = await apiCall("POST", "/api/v1/pickups", {
      merchantId, shipmentIds: [...selected], pickupAddress: address,
    });
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error?.message ?? "فشل إنشاء الطلب");
  }

  const feeHint = selected.size > 0 && selected.size < 5;

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>طلب استلام جديد</h3>
      <label className="label">التاجر</label>
      <select className="input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} style={{ marginBottom: "0.8rem" }}>
        <option value="">— اختار التاجر —</option>
        {merchants.map((m) => <option key={m.id} value={m.id}>{m.name_ar} ({m.code})</option>)}
      </select>

      {merchantId && (
        <>
          <label className="label">شحنات في انتظار الاستلام ({shipments.length})</label>
          <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 8, marginBottom: "0.8rem" }}>
            {shipments.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem", padding: 8 }}>مفيش شحنات جاهزة للاستلام عند التاجر ده</div>
            ) : shipments.map((s) => (
              <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 4px", fontSize: "0.85rem", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                <span dir="ltr" style={{ fontWeight: 700 }}>{s.awb}</span>
                <span style={{ color: "var(--muted)" }}>{s.recipient_name} · {s.governorate}</span>
              </label>
            ))}
          </div>
          <label className="label">عنوان الاستلام</label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} style={{ marginBottom: "0.8rem" }} placeholder="مخزن التاجر / العنوان" />
          {feeHint && (
            <div style={{ background: "#d9770618", color: "var(--color-warning)", borderRadius: 10, padding: "0.5rem 0.75rem", fontSize: "0.82rem", fontWeight: 700, marginBottom: "0.8rem" }}>
              أقل من ٥ أوردرات — هيتزاد رسم خدمة استلام ٥٠ ج على التاجر
            </div>
          )}
        </>
      )}

      {error && <ErrorBox msg={error} />}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || selected.size === 0 || !address} onClick={submit}>
          {busy ? "جاري..." : `طلب استلام (${selected.size})`}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
  );
}

function AssignModal({ pickup, onClose, onDone }: { pickup: Pickup; onClose: () => void; onDone: () => void }) {
  const [couriers, setCouriers] = useState<{ id: string; full_name: string }[]>([]);
  const [courierId, setCourierId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiCall<{ couriers: typeof couriers }>("GET", "/api/v1/couriers").then((r) => setCouriers(r.data?.couriers ?? []));
  }, []);

  async function submit() {
    setError(null); setBusy(true);
    const r = await apiCall("POST", `/api/v1/pickups/${pickup.id}/assign`, { courierId });
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error?.message ?? "فشل الإسناد");
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>إسناد استلام {pickup.code}</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>{pickup.orders_count} شحنة · {pickup.merchant_name}</div>
      <label className="label">المندوب</label>
      <select className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)} style={{ marginBottom: "1rem" }}>
        <option value="">— اختار المندوب —</option>
        {couriers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
      </select>
      {error && <ErrorBox msg={error} />}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !courierId} onClick={submit}>{busy ? "جاري..." : "إسناد"}</button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
  );
}

function Loading() { return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>; }
function Th({ children }: { children: React.ReactNode }) { return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.78rem", color: "var(--muted)" }}>{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td style={{ padding: "0.7rem 0.85rem", verticalAlign: "middle" }}>{children}</td>; }
