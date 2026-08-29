"use client";

/**
 * المخزن وتعدد الفروع — جرد بالباركود + شيتات السفر + الفروع.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

type Tab = "inventory" | "transfers" | "branches";
const CST: Record<string, string> = { open: "مفتوح", closed: "مقفول", dispatched: "منزّل", received: "اتستلم", cancelled: "ملغي" };

export default function WarehousePage() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<Tab>("inventory");
  if (!user) return <Loading />;
  const tabs: { k: Tab; l: string }[] = [{ k: "inventory", l: "الجرد" }, { k: "transfers", l: "شيتات السفر" }, { k: "branches", l: "الفروع" }];
  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.15rem" }}>المخزن والفروع</h2>
        <div style={{ display: "flex", gap: 4, marginBottom: "1.25rem" }}>
          {tabs.map((t) => <button key={t.k} onClick={() => setTab(t.k)} className={tab === t.k ? "btn btn-primary" : "btn btn-ghost"} style={{ padding: "0.45rem 1.1rem", fontSize: "0.86rem" }}>{t.l}</button>)}
        </div>
        {tab === "inventory" && <InventoryTab />}
        {tab === "transfers" && <TransfersTab />}
        {tab === "branches" && <BranchesTab />}
      </main>
    </div>
  );
}

// ─── الجرد ───
function InventoryTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [active, setActive] = useState<{ id: string; code: string; expected: number } | null>(null);
  const load = useCallback(async () => { const r = await apiCall<{ counts: Record<string, unknown>[] }>("GET", "/api/v1/inventory"); if (r.ok && r.data) setRows(r.data.counts); }, []);
  useEffect(() => { load(); }, [load]);
  async function start() { const r = await apiCall<{ id: string; code: string; expected: number }>("POST", "/api/v1/inventory", {}); if (r.ok && r.data) setActive(r.data); }
  if (active) return <ScanStation count={active} onClose={() => { setActive(null); load(); }} />;
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={start}>▶ بدء جرد جديد (الفرع الرئيسي)</button></div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 640 }}>
          <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>الكود</Th><Th>الحالة</Th><Th>متوقع</Th><Th>معدود</Th><Th>ناقص</Th><Th>زيادة</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش جرد لسه</td></tr> :
             rows.map((c) => (
              <tr key={c.id as string} style={{ borderTop: "1px solid var(--border)" }}>
                <Td><span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{c.code as string}</span></Td>
                <Td>{CST[c.status as string]}</Td><Td>{c.expected_count as number}</Td><Td>{c.counted_count as number}</Td>
                <Td>{(c.missing_count as number) > 0 ? <b style={{ color: "var(--color-danger)" }}>{c.missing_count as number}</b> : "0"}</Td>
                <Td>{(c.unexpected_count as number) > 0 ? <b style={{ color: "var(--color-warning)" }}>{c.unexpected_count as number}</b> : "0"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ScanStation({ count, onClose }: { count: { id: string; code: string; expected: number }; onClose: () => void }) {
  const [awb, setAwb] = useState("");
  const [feed, setFeed] = useState<{ result: string; awb: string } | null>(null);
  const [counts, setCounts] = useState({ matched: 0, unexpected: 0 });
  const [report, setReport] = useState<{ counted: number; missing: number; unexpected: number; missingAwbs: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, [feed]);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    const v = awb.trim(); if (!v) return;
    setAwb("");
    const r = await apiCall<{ result: string; already: boolean }>("POST", `/api/v1/inventory/${count.id}`, { action: "scan", awb: v });
    if (r.ok && r.data) {
      setFeed({ result: r.data.result, awb: v });
      if (!r.data.already) setCounts((c) => r.data!.result === "matched" ? { ...c, matched: c.matched + 1 } : { ...c, unexpected: c.unexpected + 1 });
    }
  }
  async function close() { const r = await apiCall<{ counted: number; missing: number; unexpected: number; missingAwbs: string[] }>("POST", `/api/v1/inventory/${count.id}`, { action: "close" }); if (r.ok && r.data) setReport(r.data); }

  if (report) return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h3 style={{ marginTop: 0 }}>نتيجة الجرد {count.code}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
        <Stat n={count.expected} l="متوقع" /><Stat n={report.counted} l="معدود" c="var(--color-success)" />
        <Stat n={report.missing} l="ناقص" c={report.missing > 0 ? "var(--color-danger)" : undefined} /><Stat n={report.unexpected} l="زيادة" c={report.unexpected > 0 ? "var(--color-warning)" : undefined} />
      </div>
      {report.missingAwbs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "var(--color-danger)", marginBottom: 6 }}>بواليص ناقصة:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{report.missingAwbs.map((a) => <span key={a} style={{ fontFamily: "monospace", fontSize: "0.78rem", padding: "0.2rem 0.5rem", background: "#dc262618", borderRadius: 6 }}>{a}</span>)}</div>
        </div>
      )}
      <button className="btn btn-primary" onClick={onClose}>تمام</button>
    </div>
  );

  return (
    <div className="card" style={{ padding: "1.5rem", textAlign: "center", background: "var(--color-navy-900)", color: "#fff" }}>
      <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>جرد {count.code} · متوقع {count.expected}</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 24, margin: "1rem 0" }}>
        <div><div style={{ fontSize: "2rem", fontWeight: 800, color: "#4ade80" }}>{counts.matched}</div><div style={{ fontSize: "0.75rem", opacity: 0.7 }}>مطابق</div></div>
        <div><div style={{ fontSize: "2rem", fontWeight: 800, color: "#fbbf24" }}>{counts.unexpected}</div><div style={{ fontSize: "0.75rem", opacity: 0.7 }}>زيادة</div></div>
      </div>
      {feed && (
        <div style={{ fontSize: "2.5rem", margin: "0.5rem 0", color: feed.result === "matched" ? "#4ade80" : "#fbbf24" }}>
          {feed.result === "matched" ? "✓" : "⚠"} <span style={{ fontSize: "0.9rem", fontFamily: "monospace" }}>{feed.awb}</span>
        </div>
      )}
      <form onSubmit={scan}>
        <input ref={inputRef} value={awb} onChange={(e) => setAwb(e.target.value)} autoFocus placeholder="امسح البوليصة..." dir="ltr"
          style={{ width: "100%", maxWidth: 340, padding: "0.9rem", fontSize: "1.2rem", textAlign: "center", borderRadius: 12, border: "2px solid #ffffff44", background: "#ffffff11", color: "#fff" }} />
      </form>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 20 }}>
        <button className="btn btn-primary" onClick={close}>إقفال الجرد وعرض النتيجة</button>
        <button className="btn btn-ghost" onClick={onClose} style={{ color: "#fff", borderColor: "#ffffff33" }}>خروج</button>
      </div>
    </div>
  );
}

// ─── التحويلات ───
function TransfersTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [branches, setBranches] = useState<Record<string, unknown>[]>([]);
  const load = useCallback(async () => {
    const [t, b] = await Promise.all([apiCall<{ transfers: Record<string, unknown>[] }>("GET", "/api/v1/transfers"), apiCall<{ branches: Record<string, unknown>[] }>("GET", "/api/v1/branches")]);
    if (t.ok && t.data) setRows(t.data.transfers); if (b.ok && b.data) setBranches(b.data.branches);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function act(id: string, action: string) { await apiCall("POST", `/api/v1/transfers/${id}`, { action }); load(); }
  async function create(toBranchId: string) { await apiCall("POST", "/api/v1/transfers", { toBranchId }); load(); }
  return (
    <>
      <div style={{ marginBottom: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>شيت سفر جديد إلى:</span>
        {branches.filter((b) => b.code !== "MAIN").map((b) => <button key={b.id as string} className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => create(b.id as string)}>{b.name_ar as string}</button>)}
        {branches.filter((b) => b.code !== "MAIN").length === 0 && <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>(اعمل فرع تاني الأول)</span>}
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 640 }}>
          <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>الكود</Th><Th>من</Th><Th>إلى</Th><Th>عدد</Th><Th>الحالة</Th><Th>إجراء</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش شيتات سفر</td></tr> :
             rows.map((t) => (
              <tr key={t.id as string} style={{ borderTop: "1px solid var(--border)" }}>
                <Td><span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{t.code as string}</span></Td>
                <Td>{(t.from_branch as string) ?? "—"}</Td><Td>{t.to_branch as string}</Td><Td>{t.shipments_count as number}</Td><Td>{CST[t.status as string]}</Td>
                <Td>
                  {t.status === "open" && <button className="btn btn-ghost" style={btnS} onClick={() => act(t.id as string, "dispatch")}>نزّل</button>}
                  {t.status === "dispatched" && <button className="btn btn-ghost" style={{ ...btnS, color: "var(--color-success)" }} onClick={() => act(t.id as string, "receive")}>استلم</button>}
                  {(t.status === "received" || t.status === "cancelled") && <span style={{ color: "var(--muted)" }}>—</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 8 }}>إضافة الشحنات للشيت بتتم من صفحة الشحنات (إجراءات جماعية) — هنا الإدارة والتنزيل والاستلام.</p>
    </>
  );
}

// ─── الفروع ───
function BranchesTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [show, setShow] = useState(false);
  const load = useCallback(async () => { const r = await apiCall<{ branches: Record<string, unknown>[] }>("GET", "/api/v1/branches"); if (r.ok && r.data) setRows(r.data.branches); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setShow(true)}>+ فرع جديد</button></div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 560 }}>
          <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>الكود</Th><Th>الفرع</Th><Th>كاش الخزنة</Th><Th>في المخزن</Th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id as string} style={{ borderTop: "1px solid var(--border)" }}>
                <Td><span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{b.code as string}</span></Td>
                <Td><b>{b.name_ar as string}</b></Td><Td>{b.cash as string}</Td><Td>{b.at_hub as number} شحنة</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && <BranchModal onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
    </>
  );
}
function BranchModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: "", nameAr: "", phone: "" });
  const [err, setErr] = useState<string | null>(null);
  async function submit() { const r = await apiCall("POST", "/api/v1/branches", { code: f.code, nameAr: f.nameAr, phone: f.phone || null }); if (r.ok) onDone(); else setErr(r.error?.message ?? "فشل"); }
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>فرع جديد</h3>
      <label className="label">الكود</label><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} dir="ltr" style={{ textAlign: "right", marginBottom: 10 }} placeholder="TANTA" />
      <label className="label">اسم الفرع</label><input className="input" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} style={{ marginBottom: 10 }} />
      <label className="label">تليفون</label><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" style={{ textAlign: "right", marginBottom: 10 }} />
      {err && <ErrorBox msg={err} />}
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn-primary" style={{ flex: 1 }} disabled={!f.code.trim() || !f.nameAr.trim()} onClick={submit}>إنشاء (بخزنته)</button><button className="btn btn-ghost" onClick={onClose}>إلغاء</button></div>
    </Overlay>
  );
}

const btnS = { padding: "0.3rem 0.7rem", fontSize: "0.8rem" };
function Stat({ n, l, c }: { n: number; l: string; c?: string }) { return <div style={{ textAlign: "center" }}><div style={{ fontSize: "1.8rem", fontWeight: 800, color: c ?? "var(--text)" }}>{n}</div><div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{l}</div></div>; }
function Loading() { return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>; }
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ padding: "0.65rem 0.8rem", fontWeight: 700, fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children }: { children?: React.ReactNode }) { return <td style={{ padding: "0.6rem 0.8rem", verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</td>; }
