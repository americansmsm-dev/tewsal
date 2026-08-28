"use client";

/**
 * شاشة التسويات (المالية) — قائمة + اعتماد + دفع.
 * فوق حد الاعتماد بيطلب شخصين مختلفين (قرار ٦).
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface Settlement {
  id: string;
  code: string;
  status: string;
  net_payable_p: string;
  requires_two_approvals: boolean;
  approved_once: boolean;
  approved_twice: boolean;
  merchant_name: string | null;
  merchant_code: string | null;
  created_at: string;
  paid_at: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة", approved: "معتمدة", paid: "مدفوعة", cancelled: "ملغاة", failed: "فشلت",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "var(--color-warning)", approved: "#2563eb", paid: "var(--color-success)", cancelled: "var(--muted)", failed: "var(--color-danger)",
};

function egp(p: string): string {
  const v = BigInt(p || "0");
  return `${(v / 100n).toLocaleString("en-US")}.${(v % 100n).toString().padStart(2, "0")} ج`;
}

export default function SettlementsPage() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [payFor, setPayFor] = useState<Settlement | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await apiCall<{ settlements: Settlement[] }>("GET", "/api/v1/settlements");
    if (r.ok) setRows(r.data?.settlements ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (user) load(); }, [user, load]);

  async function approve(s: Settlement) {
    setMsg(null);
    const r = await apiCall<{ status: string; approvals: number }>("POST", `/api/v1/settlements/${s.id}/approve`);
    if (r.ok) {
      setMsg({ ok: true, text: r.data?.status === "approved" ? `اتعتمدت ${s.code}` : `اعتماد أول لـ ${s.code} — محتاجة اعتماد تاني` });
      load();
    } else setMsg({ ok: false, text: r.error?.message ?? "فشل الاعتماد" });
  }

  if (!user) return <Loading />;
  const canAct = ["super_admin", "branch_manager", "accountant"].includes(user.role);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1050, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.15rem" }}>التسويات</h2>
        {msg && (
          <div style={{ marginBottom: 12, padding: "0.6rem 0.9rem", borderRadius: 10, fontSize: "0.88rem", fontWeight: 600,
            background: msg.ok ? "var(--green-soft, #16a34a1f)" : "#dc262618", color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>
            {msg.text}
          </div>
        )}
        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>الكود</Th><Th>التاجر</Th><Th>الصافي</Th><Th>الاعتماد</Th><Th>الحالة</Th><Th>إجراء</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش تسويات لسه — شغّل تسوية من كشف تاجر</td></tr>
              ) : rows.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td><span dir="ltr" style={{ fontWeight: 700 }}>{s.code}</span></Td>
                  <Td>{s.merchant_name ?? "—"}</Td>
                  <Td><b>{egp(s.net_payable_p)}</b></Td>
                  <Td>
                    {s.requires_two_approvals ? (
                      <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                        شخصين {s.approved_twice ? "✓✓" : s.approved_once ? "✓·" : "··"}
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{s.approved_once ? "✓" : "—"}</span>
                    )}
                  </Td>
                  <Td><span className="badge" style={{ color: STATUS_COLOR[s.status] }}>{STATUS_LABEL[s.status] ?? s.status}</span></Td>
                  <Td>
                    {!canAct ? <span style={{ color: "var(--muted)" }}>—</span> :
                     s.status === "paid" ? <span style={{ color: "var(--color-success)", fontSize: "0.8rem" }}>✓ اتدفعت</span> :
                     s.status === "cancelled" ? <span style={{ color: "var(--muted)" }}>—</span> :
                     (s.status === "approved") ? (
                       <button className="btn btn-primary" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => setPayFor(s)}>دفع</button>
                     ) : (
                       <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => approve(s)}>اعتماد</button>
                     )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {payFor && <PayModal settlement={payFor} onClose={() => setPayFor(null)} onDone={(text) => { setPayFor(null); setMsg({ ok: true, text }); load(); }} />}
    </div>
  );
}

function PayModal({ settlement, onClose, onDone }: { settlement: Settlement; onClose: () => void; onDone: (t: string) => void }) {
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");
  const [cashFee, setCashFee] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null); setBusy(true);
    const body: Record<string, unknown> = { method, reference };
    if (method === "cash") body.cashFee = cashFee;
    const r = await apiCall("POST", `/api/v1/settlements/${settlement.id}/pay`, body);
    setBusy(false);
    if (r.ok) onDone(`اتدفعت ${settlement.code} — ${egp(settlement.net_payable_p)}`);
    else setError(r.error?.message ?? "فشل الدفع");
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>دفع التسوية {settlement.code}</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        الصافي: <b style={{ color: "var(--text)" }}>{egp(settlement.net_payable_p)}</b> · {settlement.merchant_name}
      </div>
      <label className="label">طريقة الصرف</label>
      <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} style={{ marginBottom: "0.8rem" }}>
        <option value="bank">تحويل بنكي</option>
        <option value="vodafone_cash">فودافون كاش</option>
        <option value="instapay">إنستاباي</option>
        <option value="cash">كاش (+٥٠ ج مصاريف مندوب)</option>
      </select>
      <label className="label">مرجع التحويل</label>
      <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" style={{ textAlign: "right", marginBottom: "0.8rem" }} placeholder="رقم العملية" />
      {method === "cash" && (
        <>
          <label className="label">رسم استلام الكاش (ج)</label>
          <input className="input" value={cashFee} onChange={(e) => setCashFee(e.target.value)} dir="ltr" style={{ textAlign: "right", marginBottom: "0.8rem" }} />
        </>
      )}
      {error && <ErrorBox msg={error} />}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={submit}>{busy ? "جاري..." : "تأكيد الدفع"}</button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
  );
}

function Loading() { return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>; }
function Th({ children }: { children: React.ReactNode }) { return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.78rem", color: "var(--muted)" }}>{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td style={{ padding: "0.7rem 0.85rem", verticalAlign: "middle" }}>{children}</td>; }
