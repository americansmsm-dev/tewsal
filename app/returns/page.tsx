"use client";

/**
 * دورة المرتجعات المفصّلة — سجل المرتجعات على الرفوف، بأعمارها
 * ومستوى تصعيدها (١٤/٣٠ يوم). العمليات بتحط كل مرتجع على رف،
 * ومدير النظام بيتلف اللي شاخ بعد المدة (بيتحاسب عليه شحن).
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface ReturnRow {
  id: string;
  shipmentId: string;
  awb: string;
  merchantName: string;
  status: string;
  shelfId: string | null;
  shelfCode: string | null;
  shelfName: string | null;
  enteredAt: string;
  ageDays: number;
  escalationLevel: number;
  disposedAt: string | null;
  returnedAt: string | null;
}
interface Shelf { id: string; code: string; nameAr: string; isActive: boolean; onShelf: number }

const STATUS_AR: Record<string, string> = {
  awaiting_return: "على الرف",
  out_for_return: "خرج للإرجاع",
  returned_to_merchant: "اتسلّم للتاجر",
  disposed: "أُتلِف",
};
const STATUS_TONE: Record<string, string> = {
  awaiting_return: "var(--color-warning)",
  out_for_return: "var(--color-orange-600)",
  returned_to_merchant: "var(--color-success)",
  disposed: "var(--color-danger)",
};

const FILTERS = [
  { key: "active", label: "على الرف" },
  { key: "escalated", label: "متصعّدة" },
  { key: "all", label: "الكل" },
] as const;

export default function ReturnsPage() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [thresholds, setThresholds] = useState<[number, number]>([14, 30]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("active");
  const [loading, setLoading] = useState(true);
  const [disposeTarget, setDisposeTarget] = useState<ReturnRow | null>(null);
  const [showShelves, setShowShelves] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, s] = await Promise.all([
      apiCall<{ returns: ReturnRow[]; thresholds: [number, number] }>("GET", `/api/v1/returns?filter=${filter}`),
      apiCall<{ shelves: Shelf[] }>("GET", "/api/v1/return-shelves"),
    ]);
    if (r.ok && r.data) { setRows(r.data.returns); setThresholds(r.data.thresholds); }
    if (s.ok && s.data) setShelves(s.data.shelves);
    setLoading(false);
  }, [filter]);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return <Loading />;
  const canOps = ["super_admin", "branch_manager", "ops"].includes(user.role);
  const isAdmin = user.role === "super_admin";
  const [t1, t2] = thresholds;

  async function assign(row: ReturnRow, shelfId: string | null) {
    const r = await apiCall("POST", `/api/v1/returns/${row.shipmentId}/shelf`, { shelfId });
    if (r.ok) load();
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem" }}>المرتجعات</h2>
            <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.85rem" }}>
              المرتجعات على الرفوف بأعمارها. التصعيد بعد <b>{t1}</b> يوم (تنبيه) و<b>{t2}</b> يوم (مؤهّل للإتلاف).
            </p>
          </div>
          <button className="btn btn-ghost" onClick={() => setShowShelves(true)}>
            الرفوف ({shelves.length})
          </button>
        </div>

        {/* تبويبات الفلترة */}
        <div style={{ display: "flex", gap: 4, marginBottom: "1rem" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={filter === f.key ? "btn btn-primary" : "btn btn-ghost"}
              style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 820 }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>الشحنة</Th><Th>التاجر</Th><Th>الحالة</Th><Th>الرف</Th><Th>العمر</Th><Th>التصعيد</Th><Th>إجراء</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش مرتجعات هنا 🎉</td></tr>
              ) : rows.map((r) => {
                const onShelf = r.status === "awaiting_return";
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td><span style={{ fontFamily: "monospace", fontWeight: 700 }}>{r.awb}</span></Td>
                    <Td>{r.merchantName}</Td>
                    <Td><span style={{ fontWeight: 700, color: STATUS_TONE[r.status] }}>{STATUS_AR[r.status] ?? r.status}</span></Td>
                    <Td>
                      {onShelf && canOps ? (
                        <select
                          value={r.shelfId ?? ""}
                          onChange={(e) => assign(r, e.target.value || null)}
                          className="input"
                          style={{ padding: "0.3rem 0.5rem", fontSize: "0.8rem", minWidth: 130 }}
                        >
                          <option value="">— بدون رف —</option>
                          {shelves.filter((s) => s.isActive || s.id === r.shelfId).map((s) => (
                            <option key={s.id} value={s.id}>{s.code} · {s.nameAr}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>{r.shelfCode ?? "—"}</span>
                      )}
                    </Td>
                    <Td>{onShelf ? <span>{r.ageDays} يوم</span> : "—"}</Td>
                    <Td><EscalationBadge level={r.escalationLevel} t1={t1} t2={t2} /></Td>
                    <Td>
                      {onShelf && r.escalationLevel >= 2 && isAdmin ? (
                        <button className="btn btn-ghost" style={{ color: "var(--color-danger)", padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => setDisposeTarget(r)}>إتلاف</button>
                      ) : r.disposedAt ? (
                        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>اتأتلف</span>
                      ) : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {disposeTarget && (
        <DisposeModal row={disposeTarget} t2={t2} onClose={() => setDisposeTarget(null)} onDone={() => { setDisposeTarget(null); load(); }} />
      )}
      {showShelves && (
        <ShelvesModal shelves={shelves} canCreate={canOps} onClose={() => setShowShelves(false)} onChange={load} />
      )}
    </div>
  );
}

function EscalationBadge({ level, t1, t2 }: { level: number; t1: number; t2: number }) {
  if (level === 0) return <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>عادي</span>;
  const tone = level >= 2 ? "var(--color-danger)" : "var(--color-warning)";
  const label = level >= 2 ? `🔴 عدّى ${t2} يوم` : `⚠️ عدّى ${t1} يوم`;
  return <span style={{ fontWeight: 700, color: tone, fontSize: "0.8rem" }}>{label}</span>;
}

function DisposeModal({ row, t2, onClose, onDone }: {
  row: ReturnRow; t2: number; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null); setBusy(true);
    const r = await apiCall("POST", `/api/v1/returns/${row.shipmentId}/dispose`, { reason, overrideAge: override });
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error?.message ?? "فشل");
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>إتلاف المرتجع {row.awb}</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: 12 }}>
        {row.merchantName} · عمره <b style={{ color: "var(--text)" }}>{row.ageDays} يوم</b>
      </div>
      <div style={{ padding: "0.6rem 0.8rem", borderRadius: 10, background: "#dc262618", color: "var(--color-danger)", fontSize: "0.82rem", fontWeight: 700, marginBottom: 12 }}>
        ⚠️ الإتلاف نهائي — الشحنة هتتقفل وبيتحاسب عليها شحن على التاجر. القرار بيتسجّل باسمك.
      </div>
      <label className="label">سبب الإتلاف (إجباري)</label>
      <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="التاجر مش بيرد بعد محاولات، البضاعة اتخلّى عنها..." />
      {row.ageDays < t2 && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: "0.82rem" }}>
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          تجاوز شرط المدة ({t2} يوم) — عمره لسه {row.ageDays} يوم
        </label>
      )}
      {error && <div style={{ marginTop: 10 }}><ErrorBox msg={error} /></div>}
      <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
        <button className="btn btn-primary" style={{ flex: 1, background: "var(--color-danger)" }} disabled={busy || !reason.trim()} onClick={submit}>
          {busy ? "..." : "تأكيد الإتلاف"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
  );
}

function ShelvesModal({ shelves, canCreate, onClose, onChange }: {
  shelves: Shelf[]; canCreate: boolean; onClose: () => void; onChange: () => void;
}) {
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setError(null); setBusy(true);
    const r = await apiCall("POST", "/api/v1/return-shelves", { code, nameAr });
    setBusy(false);
    if (r.ok) { setCode(""); setNameAr(""); onChange(); } else setError(r.error?.message ?? "فشل");
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>رفوف المرتجعات</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: canCreate ? 16 : 0 }}>
        {shelves.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>مفيش رفوف لسه</div>
        ) : shelves.map((s) => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0.75rem", borderRadius: 8, background: "var(--bg-soft)", fontSize: "0.85rem" }}>
            <span><b style={{ fontFamily: "monospace" }}>{s.code}</b> · {s.nameAr}{!s.isActive && <span style={{ color: "var(--muted)" }}> (متوقف)</span>}</span>
            <span style={{ color: "var(--muted)" }}>{s.onShelf} مرتجع</span>
          </div>
        ))}
      </div>

      {canCreate && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <label className="label">رف جديد</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="الكود (R-D)" style={{ maxWidth: 120 }} />
            <input className="input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="الاسم" style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || !code.trim() || !nameAr.trim()} onClick={create}>إضافة</button>
          </div>
          {error && <div style={{ marginTop: 10 }}><ErrorBox msg={error} /></div>}
        </div>
      )}
      <div style={{ marginTop: 16, textAlign: "left" }}>
        <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
      </div>
    </Overlay>
  );
}

function Loading() {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.76rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.65rem 0.85rem", verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</td>;
}
