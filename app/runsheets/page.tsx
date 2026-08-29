"use client";

/**
 * كشوف المناديب — العمليات تفتح كشف لمندوب، تنزّل عليه شحنات
 * المخزن (تخرج للتسليم)، وتقفله فتتقيّد عمولة المندوب.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface RunSheet {
  id: string;
  code: string;
  status: string;
  shipments_count: number;
  delivered_count: number;
  commission_p: string;
  courier_name: string | null;
  created_at: string;
}
interface Courier { id: string; full_name: string }

const STATUS_AR: Record<string, string> = {
  open: "مفتوح", dispatched: "منزّل", closed: "مقفول", cancelled: "ملغي",
};
const STATUS_TONE: Record<string, string> = {
  open: "var(--color-warning)", dispatched: "var(--color-success)", closed: "var(--muted)", cancelled: "var(--color-danger)",
};
function egp(p: string) { return (Number(p) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }) + " ج"; }

export default function RunSheetsPage() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<RunSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dispatch, setDispatch] = useState<RunSheet | null>(null);

  const load = useCallback(async () => {
    const r = await apiCall<{ runSheets: RunSheet[] }>("GET", "/api/v1/run-sheets");
    if (r.ok && r.data) setRows(r.data.runSheets);
    setLoading(false);
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  async function close(rs: RunSheet) {
    if (!confirm(`إغلاق الكشف ${rs.code}؟ هتتقيّد عمولة المندوب على المسلَّم.`)) return;
    const r = await apiCall("POST", `/api/v1/run-sheets/${rs.id}/close`);
    if (!r.ok) alert(r.error?.message ?? "فشل الإغلاق");
    load();
  }

  if (!user) return <Loading />;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem" }}>كشوف المناديب</h2>
          <button className="btn btn-primary" type="button" onClick={() => setCreating(true)}>+ كشف جديد</button>
        </div>

        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem", minWidth: 640 }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>الكشف</Th><Th>المندوب</Th><Th>الحالة</Th><Th>شحنات</Th><Th>مسلَّم</Th><Th>عمولة</Th><Th>إجراء</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش كشوف — افتح كشف جديد</td></tr>
              ) : rows.map((rs) => (
                <tr key={rs.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td><span style={{ fontWeight: 700, fontFamily: "monospace" }}>{rs.code}</span></Td>
                  <Td>{rs.courier_name ?? "—"}</Td>
                  <Td><span style={{ fontWeight: 700, color: STATUS_TONE[rs.status] }}>{STATUS_AR[rs.status] ?? rs.status}</span></Td>
                  <Td>{rs.shipments_count}</Td>
                  <Td>{rs.delivered_count || "—"}</Td>
                  <Td>{Number(rs.commission_p) > 0 ? egp(rs.commission_p) : "—"}</Td>
                  <Td>
                    {(rs.status === "open" || rs.status === "dispatched") && (
                      <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => setDispatch(rs)}>تنزيل شحنات</button>
                    )}
                    {rs.status === "dispatched" && (
                      <button className="btn btn-primary" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem", marginInlineStart: 6 }} onClick={() => close(rs)}>إغلاق</button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {dispatch && <DispatchModal runSheet={dispatch} onClose={() => setDispatch(null)} onDone={() => { setDispatch(null); load(); }} />}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [courierId, setCourierId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiCall<{ couriers: Courier[] }>("GET", "/api/v1/couriers").then((r) => { if (r.ok && r.data) setCouriers(r.data.couriers); });
  }, []);

  async function submit() {
    setError(null); setBusy(true);
    const r = await apiCall("POST", "/api/v1/run-sheets", { courierId });
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error?.message ?? "فشل فتح الكشف");
  }
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>كشف جديد</h3>
      <label className="label">المندوب</label>
      <select className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)}>
        <option value="">— اختار مندوب —</option>
        {couriers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
      </select>
      {error && <div style={{ marginTop: 10 }}><ErrorBox msg={error} /></div>}
      <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !courierId} onClick={submit}>{busy ? "جاري..." : "فتح الكشف"}</button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
  );
}

interface HubShipment { id: string; awb: string; recipient_name: string; governorate_name?: string }
function DispatchModal({ runSheet, onClose, onDone }: { runSheet: RunSheet; onClose: () => void; onDone: () => void }) {
  const [ships, setShips] = useState<HubShipment[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiCall<{ shipments: HubShipment[] }>("GET", "/api/v1/shipments?status=at_hub&limit=200").then((r) => {
      if (r.ok && r.data) setShips(r.data.shipments ?? []);
    });
  }, []);

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function submit() {
    setError(null); setBusy(true);
    const r = await apiCall("POST", `/api/v1/run-sheets/${runSheet.id}/dispatch`, { shipmentIds: [...picked] });
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error?.message ?? "فشل التنزيل");
  }
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>تنزيل شحنات على {runSheet.code}</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: 10 }}>شحنات المخزن (at_hub) — اختار اللي هتخرج مع {runSheet.courier_name}</div>
      <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
        {ships.length === 0 ? (
          <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>مفيش شحنات في المخزن دلوقتي</div>
        ) : ships.map((s) => (
          <label key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "0.6rem 0.8rem", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
            <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
            <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{s.awb}</span>
            <span style={{ color: "var(--muted)" }}>{s.recipient_name}</span>
          </label>
        ))}
      </div>
      {error && <div style={{ marginTop: 10 }}><ErrorBox msg={error} /></div>}
      <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || picked.size === 0} onClick={submit}>
          {busy ? "جاري..." : `تنزيل ${picked.size || ""} شحنة`}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
  );
}

function Loading() {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.7rem 0.85rem", verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</td>;
}
