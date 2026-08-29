"use client";

/**
 * التشغيل الداخلي — تاسكات + تذاكر/شكاوى + مصروفات.
 * تبويبات؛ تبويب المصروفات للمالية بس.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

type Tab = "tasks" | "tickets" | "expenses" | "notifications";
function egp(p: string) { const v = BigInt(p || "0"); return `${(v / 100n).toLocaleString("en-US")}.${(v % 100n).toString().padStart(2, "0")} ج`; }
const PRIO: Record<string, string> = { high: "عالية", urgent: "عاجلة", normal: "عادية", low: "منخفضة" };
const PRIO_TONE: Record<string, string> = { high: "var(--color-danger)", urgent: "var(--color-danger)", normal: "var(--muted)", low: "var(--muted)" };
const TSTATUS: Record<string, string> = { open: "مفتوح", in_progress: "جاري", done: "خلص", cancelled: "ملغي", pending: "معلّق", resolved: "اتحل", closed: "مقفول" };
const CAT: Record<string, string> = { complaint: "شكوى", request: "طلب", inquiry: "استفسار" };

export default function OpsPage() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<Tab>("tasks");
  if (!user) return <Loading />;
  const isFinance = ["super_admin", "branch_manager", "accountant"].includes(user.role);
  const tabs: { k: Tab; l: string; fin?: boolean }[] = [
    { k: "tasks", l: "التاسكات" }, { k: "tickets", l: "التذاكر" }, { k: "expenses", l: "المصروفات", fin: true }, { k: "notifications", l: "الإشعارات", fin: true },
  ];
  const shown = tabs.filter((t) => !t.fin || isFinance);
  const active = shown.some((t) => t.k === tab) ? tab : shown[0]!.k;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.15rem" }}>التشغيل الداخلي</h2>
        <div style={{ display: "flex", gap: 4, marginBottom: "1.25rem" }}>
          {shown.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} className={active === t.k ? "btn btn-primary" : "btn btn-ghost"} style={{ padding: "0.45rem 1.1rem", fontSize: "0.86rem" }}>{t.l}</button>
          ))}
        </div>
        {active === "tasks" && <TasksTab />}
        {active === "tickets" && <TicketsTab />}
        {active === "expenses" && <ExpensesTab />}
        {active === "notifications" && <NotificationsTab />}
      </main>
    </div>
  );
}

// ─── التاسكات ───
function TasksTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [show, setShow] = useState(false);
  const load = useCallback(async () => { const r = await apiCall<{ tasks: Record<string, unknown>[] }>("GET", "/api/v1/tasks"); if (r.ok && r.data) setRows(r.data.tasks); }, []);
  useEffect(() => { load(); }, [load]);
  async function upd(id: string, status: string) { await apiCall("POST", `/api/v1/tasks/${id}`, { status }); load(); }
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setShow(true)}>+ تاسك جديد</button></div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 640 }}>
          <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>العنوان</Th><Th>الأولوية</Th><Th>المسؤول</Th><Th>الحالة</Th><Th>إجراء</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش تاسكات 🎉</td></tr> :
             rows.map((t) => (
              <tr key={t.id as string} style={{ borderTop: "1px solid var(--border)" }}>
                <Td><b>{t.title as string}</b>{(t.overdue as boolean) && <span style={{ color: "var(--color-danger)", fontSize: "0.72rem" }}> ⏰ متأخر</span>}{t.awb ? <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontFamily: "monospace" }}>{t.awb as string}</div> : null}</Td>
                <Td><span style={{ color: PRIO_TONE[t.priority as string], fontWeight: 700, fontSize: "0.8rem" }}>{PRIO[t.priority as string]}</span></Td>
                <Td>{(t.assignee_name as string) ?? "—"}</Td>
                <Td>{TSTATUS[t.status as string]}</Td>
                <Td>
                  {t.status === "open" && <button className="btn btn-ghost" style={btnS} onClick={() => upd(t.id as string, "in_progress")}>ابدأ</button>}
                  {(t.status === "open" || t.status === "in_progress") && <button className="btn btn-ghost" style={{ ...btnS, color: "var(--color-success)" }} onClick={() => upd(t.id as string, "done")}>خلّص</button>}
                  {(t.status === "done" || t.status === "cancelled") && <span style={{ color: "var(--muted)" }}>—</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && <TaskModal onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
    </>
  );
}

function TaskModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [f, setF] = useState({ title: "", body: "", priority: "normal", assigneeId: "" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { apiCall<{ users: { id: string; full_name: string }[] }>("GET", "/api/v1/users").then((r) => setStaff(r.data?.users ?? [])); }, []);
  async function submit() {
    const body: Record<string, unknown> = { title: f.title, priority: f.priority };
    if (f.body) body.body = f.body;
    if (f.assigneeId) body.assigneeId = f.assigneeId;
    const r = await apiCall("POST", "/api/v1/tasks", body);
    if (r.ok) onDone(); else setErr(r.error?.message ?? "فشل");
  }
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>تاسك جديد</h3>
      <label className="label">العنوان</label>
      <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={{ marginBottom: 10 }} />
      <label className="label">تفاصيل</label>
      <textarea className="input" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={2} style={{ marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}><label className="label">الأولوية</label>
          <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">عالية</option></select></div>
        <div style={{ flex: 1 }}><label className="label">المسؤول</label>
          <select className="input" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}><option value="">— بدون —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
      </div>
      {err && <ErrorBox msg={err} />}
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn-primary" style={{ flex: 1 }} disabled={!f.title.trim()} onClick={submit}>إنشاء</button><button className="btn btn-ghost" onClick={onClose}>إلغاء</button></div>
    </Overlay>
  );
}

// ─── التذاكر ───
function TicketsTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [show, setShow] = useState(false);
  const [thread, setThread] = useState<Record<string, unknown> | null>(null);
  const load = useCallback(async () => { const r = await apiCall<{ tickets: Record<string, unknown>[] }>("GET", "/api/v1/tickets"); if (r.ok && r.data) setRows(r.data.tickets); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setShow(true)}>+ تذكرة جديدة</button></div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 700 }}>
          <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>الكود</Th><Th>الموضوع</Th><Th>النوع</Th><Th>الأولوية</Th><Th>الحالة</Th><Th></Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش تذاكر</td></tr> :
             rows.map((t) => (
              <tr key={t.id as string} style={{ borderTop: "1px solid var(--border)" }}>
                <Td><span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{t.code as string}</span></Td>
                <Td><b>{t.subject as string}</b>{t.merchant_name ? <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{t.merchant_name as string}</div> : null}</Td>
                <Td>{CAT[t.category as string]}</Td>
                <Td><span style={{ color: PRIO_TONE[t.priority as string], fontWeight: 700, fontSize: "0.8rem" }}>{PRIO[t.priority as string]}</span></Td>
                <Td>{TSTATUS[t.status as string]}</Td>
                <Td><button className="btn btn-ghost" style={btnS} onClick={() => setThread(t)}>فتح</button></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && <TicketModal onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
      {thread && <ThreadModal ticket={thread} onClose={() => setThread(null)} onChange={load} />}
    </>
  );
}

function TicketModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ category: "inquiry", subject: "", priority: "normal", customerPhone: "", body: "" });
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    const body: Record<string, unknown> = { category: f.category, subject: f.subject, priority: f.priority };
    if (f.customerPhone) body.customerPhone = f.customerPhone;
    if (f.body) body.body = f.body;
    const r = await apiCall("POST", "/api/v1/tickets", body);
    if (r.ok) onDone(); else setErr(r.error?.message ?? "فشل");
  }
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>تذكرة جديدة</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}><label className="label">النوع</label><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="inquiry">استفسار</option><option value="complaint">شكوى</option><option value="request">طلب</option></select></div>
        <div style={{ flex: 1 }}><label className="label">الأولوية</label><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select></div>
      </div>
      <label className="label">الموضوع</label>
      <input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} style={{ marginBottom: 10 }} />
      <label className="label">موبايل العميل (اختياري)</label>
      <input className="input" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} dir="ltr" style={{ textAlign: "right", marginBottom: 10 }} />
      <label className="label">التفاصيل</label>
      <textarea className="input" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={2} style={{ marginBottom: 10 }} />
      {err && <ErrorBox msg={err} />}
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn-primary" style={{ flex: 1 }} disabled={!f.subject.trim()} onClick={submit}>إنشاء</button><button className="btn btn-ghost" onClick={onClose}>إلغاء</button></div>
    </Overlay>
  );
}

function ThreadModal({ ticket, onClose, onChange }: { ticket: Record<string, unknown>; onClose: () => void; onChange: () => void }) {
  const [thread, setThread] = useState<Record<string, unknown>[]>([]);
  const [msg, setMsg] = useState("");
  const id = ticket.id as string;
  const load = useCallback(async () => { const r = await apiCall<{ thread: Record<string, unknown>[] }>("GET", `/api/v1/tickets/${id}`); if (r.ok && r.data) setThread(r.data.thread); }, [id]);
  useEffect(() => { load(); }, [load]);
  async function send() { if (!msg.trim()) return; await apiCall("POST", `/api/v1/tickets/${id}`, { action: "message", body: msg }); setMsg(""); load(); }
  async function setStatus(status: string) { await apiCall("POST", `/api/v1/tickets/${id}`, { action: "update", status }); onChange(); onClose(); }
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>{ticket.subject as string}</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: 12 }}>{ticket.code as string} · {CAT[ticket.category as string]} · {TSTATUS[ticket.status as string]}</div>
      <div style={{ maxHeight: 240, overflow: "auto", display: "grid", gap: 6, marginBottom: 12 }}>
        {thread.length === 0 ? <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>مفيش رسائل</div> :
         thread.map((m, i) => (
          <div key={i} style={{ padding: "0.5rem 0.7rem", borderRadius: 8, background: "var(--bg-soft)", fontSize: "0.84rem" }}>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: 2 }}>{(m.by_name as string) ?? "—"}</div>{m.body as string}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input className="input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="اكتب رد..." onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn btn-primary" onClick={send}>إرسال</button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-ghost" style={{ ...btnS, color: "var(--color-success)" }} onClick={() => setStatus("resolved")}>حلّها</button>
        <button className="btn btn-ghost" style={btnS} onClick={() => setStatus("closed")}>اقفلها</button>
        <button className="btn btn-ghost" style={btnS} onClick={onClose}>إغلاق</button>
      </div>
    </Overlay>
  );
}

// ─── المصروفات ───
function ExpensesTab() {
  const [d, setD] = useState<{ expenses: Record<string, unknown>[]; categories: Record<string, unknown>[] } | null>(null);
  const [show, setShow] = useState(false);
  const load = useCallback(async () => { const r = await apiCall<{ expenses: Record<string, unknown>[]; categories: Record<string, unknown>[] }>("GET", "/api/v1/expenses"); if (r.ok && r.data) setD(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setShow(true)}>+ تسجيل مصروف</button></div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 640 }}>
          <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>الكود</Th><Th>البند</Th><Th>الوصف</Th><Th>المبلغ</Th><Th>من</Th></tr></thead>
          <tbody>
            {!d || d.expenses.length === 0 ? <tr><td colSpan={5} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش مصروفات</td></tr> :
             d.expenses.map((e) => (
              <tr key={e.id as string} style={{ borderTop: "1px solid var(--border)" }}>
                <Td><span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.code as string}</span></Td>
                <Td>{e.category as string}</Td><Td>{e.description_ar as string}</Td>
                <Td><b style={{ color: "var(--color-danger)" }}>{egp(e.amount_p as string)}</b></Td>
                <Td>{e.paid_from === "bank" ? "البنك" : "الخزنة"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && d && <ExpenseModal categories={d.categories} onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
    </>
  );
}

function ExpenseModal({ categories, onClose, onDone }: { categories: Record<string, unknown>[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ categoryId: "", amount: "", description: "", paidFrom: "branch_cash", vehicleRef: "" });
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    const body: Record<string, unknown> = { categoryId: f.categoryId, amount: f.amount, description: f.description, paidFrom: f.paidFrom };
    if (f.vehicleRef) body.vehicleRef = f.vehicleRef;
    const r = await apiCall("POST", "/api/v1/expenses", body);
    if (r.ok) onDone(); else setErr(r.error?.message ?? "فشل");
  }
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>تسجيل مصروف</h3>
      <label className="label">البند</label>
      <select className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} style={{ marginBottom: 10 }}>
        <option value="">— اختار —</option>{categories.map((c) => <option key={c.id as string} value={c.id as string}>{c.name_ar as string}</option>)}
      </select>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}><label className="label">المبلغ (ج)</label><input className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" dir="ltr" style={{ textAlign: "right" }} /></div>
        <div style={{ width: 130 }}><label className="label">الدفع من</label><select className="input" value={f.paidFrom} onChange={(e) => setF({ ...f, paidFrom: e.target.value })}><option value="branch_cash">الخزنة</option><option value="bank">البنك</option></select></div>
      </div>
      <label className="label">الوصف</label>
      <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ marginBottom: 10 }} />
      {err && <ErrorBox msg={err} />}
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn-primary" style={{ flex: 1 }} disabled={!f.categoryId || !f.amount || !f.description.trim()} onClick={submit}>تسجيل (بيتقيّد في الدفتر)</button><button className="btn btn-ghost" onClick={onClose}>إلغاء</button></div>
    </Overlay>
  );
}

// ─── الإشعارات ───
const EV_AR: Record<string, string> = { picked_up: "الاستلام", out_for_delivery: "خرج للتسليم", delivered: "تم التسليم", delivery_failed: "تعذّر", returned_to_merchant: "إرجاع" };
const NST: Record<string, string> = { sent: "اتبعت", simulated: "محاكاة", failed: "فشل", blocked_limit: "تخطّى الحد" };
function NotificationsTab() {
  const [d, setD] = useState<{ templates: Record<string, unknown>[]; log: Record<string, unknown>[]; whatsappLive: boolean } | null>(null);
  const load = useCallback(async () => { const r = await apiCall<{ templates: Record<string, unknown>[]; log: Record<string, unknown>[]; whatsappLive: boolean }>("GET", "/api/v1/notifications"); if (r.ok && r.data) setD(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div style={{ color: "var(--muted)" }}>جاري التحميل...</div>;
  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {!d.whatsappLive && <div style={{ padding: "0.7rem 1rem", borderRadius: 10, background: "var(--warn-soft, #fbeed7)", color: "var(--color-warning)", fontSize: "0.85rem", fontWeight: 600 }}>⚠️ واتساب مش متضبط — الإشعارات بتتسجّل «محاكاة». أضف مفاتيح WHATSAPP_TOKEN و WHATSAPP_PHONE_ID للتفعيل.</div>}
      <div className="card" style={{ padding: "1rem 1.2rem" }}>
        <h3 style={{ margin: "0 0 0.8rem", fontSize: "1rem" }}>القوالب (تتعدّل بدون نشر)</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {d.templates.map((t) => <TemplateRow key={t.id as string} t={t} onSaved={load} />)}
        </div>
        <p style={{ fontSize: "0.76rem", color: "var(--muted)", marginTop: 8 }}>المتغيرات: {"{awb} {reason} {track} {phone}"}</p>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <h3 style={{ margin: "0.8rem 1rem", fontSize: "1rem" }}>آخر الإشعارات</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 560 }}>
          <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>الحدث</Th><Th>لـ</Th><Th>الحالة</Th><Th>التكلفة</Th></tr></thead>
          <tbody>
            {d.log.length === 0 ? <tr><td colSpan={4} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>مفيش إشعارات</td></tr> :
             d.log.slice(0, 40).map((l, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <Td>{EV_AR[l.event as string] ?? l.event as string}</Td>
                <Td><span dir="ltr" style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{l.to_phone as string}</span></Td>
                <Td>{NST[l.status as string] ?? l.status as string}</Td>
                <Td>{l.cost as string}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function TemplateRow({ t, onSaved }: { t: Record<string, unknown>; onSaved: () => void }) {
  const [v, setV] = useState(t.body_ar as string);
  const [saved, setSaved] = useState(false);
  async function save() { const r = await apiCall("POST", "/api/v1/notifications", { id: t.id, bodyAr: v }); if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); onSaved(); } }
  return (
    <div>
      <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: 3 }}>{EV_AR[t.key as string] ?? t.key as string}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} style={{ fontSize: "0.83rem" }} />
        <button className="btn btn-ghost" style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem", color: saved ? "var(--color-success)" : undefined }} onClick={save}>{saved ? "✓" : "حفظ"}</button>
      </div>
    </div>
  );
}

const btnS = { padding: "0.3rem 0.7rem", fontSize: "0.8rem" };
function Loading() { return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>; }
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ padding: "0.65rem 0.8rem", fontWeight: 700, fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children }: { children?: React.ReactNode }) { return <td style={{ padding: "0.6rem 0.8rem", verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</td>; }
