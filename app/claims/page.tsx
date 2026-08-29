"use client";

/**
 * المطالبات والتعويض — مراجعة شحنات مفقودة/تالفة واعتماد
 * التعويض (بحد ٦٠٠ ج والقيمة المعلنة) أو رفضه.
 * القابل للكسر غير المؤمّن محظور إلا بتجاوز مدير النظام.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface Claim {
  id: string;
  code: string;
  awb: string;
  type: string;
  status: string;
  merchant_name: string;
  declaredValue: string;
  suggested: string;
  suggested_amount_p: string;
  approved: string | null;
  is_fragile: boolean;
  fragile_blocked: boolean;
  reject_reason: string | null;
}

const TYPE_AR: Record<string, string> = { lost: "مفقود", damaged: "تالف" };
const STATUS_AR: Record<string, string> = { open: "مفتوحة", approved: "معتمدة", rejected: "مرفوضة" };
const STATUS_TONE: Record<string, string> = { open: "var(--color-warning)", approved: "var(--color-success)", rejected: "var(--color-danger)" };

export default function ClaimsPage() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Claim | null>(null);

  const load = useCallback(async () => {
    const r = await apiCall<{ claims: Claim[] }>("GET", "/api/v1/claims");
    if (r.ok && r.data) setRows(r.data.claims);
    setLoading(false);
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return <Loading />;
  const canResolve = ["super_admin", "branch_manager", "accountant"].includes(user.role);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem" }}>المطالبات والتعويض</h2>
        <p style={{ margin: "0 0 1.25rem", color: "var(--muted)", fontSize: "0.85rem" }}>
          شحنات مفقودة/تالفة. التعويض بحد ٦٠٠ ج والقيمة المعلنة — والقابل للكسر غير المؤمّن محظور إلا بتجاوز مدير النظام.
        </p>

        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>المطالبة</Th><Th>الشحنة</Th><Th>التاجر</Th><Th>النوع</Th><Th>المعلنة</Th><Th>التعويض</Th><Th>الحالة</Th><Th>إجراء</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش مطالبات 🎉</td></tr>
              ) : rows.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td><span style={{ fontFamily: "monospace", fontWeight: 700 }}>{c.code}</span></Td>
                  <Td>
                    <span style={{ fontFamily: "monospace" }}>{c.awb}</span>
                    {c.fragile_blocked && <span title="قابل للكسر غير مؤمّن" style={{ marginInlineStart: 6 }}>⚠️</span>}
                  </Td>
                  <Td>{c.merchant_name}</Td>
                  <Td>{TYPE_AR[c.type] ?? c.type}</Td>
                  <Td>{c.declaredValue}</Td>
                  <Td><span style={{ fontWeight: 700 }}>{c.approved ?? c.suggested}</span></Td>
                  <Td><span style={{ fontWeight: 700, color: STATUS_TONE[c.status] }}>{STATUS_AR[c.status] ?? c.status}</span></Td>
                  <Td>
                    {c.status === "open" && canResolve ? (
                      <button className="btn btn-primary" style={{ padding: "0.3rem 0.8rem", fontSize: "0.8rem" }} onClick={() => setActive(c)}>مراجعة</button>
                    ) : c.status === "rejected" && c.reject_reason ? (
                      <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{c.reject_reason}</span>
                    ) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {active && (
        <ResolveModal
          claim={active}
          isSuperAdmin={user.role === "super_admin"}
          onClose={() => setActive(null)}
          onDone={() => { setActive(null); load(); }}
        />
      )}
    </div>
  );
}

function ResolveModal({ claim, isSuperAdmin, onClose, onDone }: {
  claim: Claim; isSuperAdmin: boolean; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState((Number(claim.suggested_amount_p) / 100).toString());
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(decision: "approve" | "reject") {
    setError(null); setBusy(true);
    const body: Record<string, unknown> = { decision };
    if (decision === "approve") { body.amount = amount; if (override) body.overrideFragile = true; }
    else body.rejectReason = reason;
    const r = await apiCall("POST", `/api/v1/claims/${claim.id}/resolve`, body);
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error?.message ?? "فشل");
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>مراجعة مطالبة {claim.code}</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: 12 }}>
        {TYPE_AR[claim.type]} · شحنة <b style={{ color: "var(--text)" }}>{claim.awb}</b> · معلنة {claim.declaredValue}
      </div>

      {claim.fragile_blocked && (
        <div style={{ padding: "0.6rem 0.8rem", borderRadius: 10, background: "#dc262618", color: "var(--color-danger)", fontSize: "0.82rem", fontWeight: 700, marginBottom: 12 }}>
          ⚠️ قابلة للكسر ومش مؤمّنة — التعويض محظور
          {isSuperAdmin ? (
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontWeight: 500, color: "var(--text)" }}>
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              تجاوز الحظر (مدير النظام)
            </label>
          ) : <div style={{ marginTop: 4, fontWeight: 500, color: "var(--muted)" }}>محتاج مدير النظام</div>}
        </div>
      )}

      <label className="label">مبلغ التعويض (ج) — بحد أقصى ٦٠٠ والمعلنة</label>
      <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" style={{ textAlign: "right", fontWeight: 700 }} />

      <label className="label" style={{ marginTop: 10 }}>سبب الرفض (لو هترفض)</label>
      <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />

      {error && <div style={{ marginTop: 10 }}><ErrorBox msg={error} /></div>}

      <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || (claim.fragile_blocked && !override)} onClick={() => submit("approve")}>
          {busy ? "..." : "اعتماد التعويض"}
        </button>
        <button className="btn btn-ghost" style={{ color: "var(--color-danger)" }} disabled={busy || !reason.trim()} onClick={() => submit("reject")}>رفض</button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
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
