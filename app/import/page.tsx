"use client";

/**
 * استيراد شحنات بالجملة — لصق CSV أو رفع ملف، معاينة الأخطاء
 * صف-بصف، ثم التنفيذ. الأعمدة: الاسم، الموبايل، المحافظة، العنوان، التحصيل، رقم الطلب.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface Merchant { id: string; code: string; name_ar: string }
interface Row { recipientName: string; recipientPhone: string; governorate: string; addressLine: string; codAmount?: string; merchantReference?: string }
interface Result { index: number; ok: boolean; errors: string[] }

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Row[] = [];
  for (const line of lines) {
    const c = line.split(/[,\t]/).map((x) => x.trim());
    if (c[0] === "الاسم" || c[0]?.toLowerCase() === "name") continue; // سطر العناوين
    if (!c[0] && !c[1]) continue;
    out.push({ recipientName: c[0] ?? "", recipientPhone: c[1] ?? "", governorate: c[2] ?? "", addressLine: c[3] ?? "", codAmount: c[4] || undefined, merchantReference: c[5] || undefined });
  }
  return out;
}

export default function ImportPage() {
  const user = useCurrentUser();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => { const r = await apiCall<{ merchants: Merchant[] }>("GET", "/api/v1/merchants"); if (r.ok && r.data) setMerchants(r.data.merchants); }, []);
  useEffect(() => { if (user) load(); }, [user, load]);
  if (!user) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  async function preview() {
    const parsed = parseCsv(text); setRows(parsed); setResults(null); setMsg(null);
    if (!merchantId || parsed.length === 0) { setMsg("اختار التاجر والصق البيانات"); return; }
    setBusy(true);
    const r = await apiCall<{ results: Result[]; validCount: number }>("POST", "/api/v1/imports", { action: "preview", merchantId, rows: parsed });
    setBusy(false);
    if (r.ok && r.data) { setResults(r.data.results); setMsg(`${r.data.validCount} صف صالح من ${parsed.length}`); }
    else setMsg(r.error?.message ?? "فشل");
  }
  async function commit() {
    const valid = rows.filter((_, i) => results?.find((r) => r.index === i)?.ok);
    if (valid.length === 0) return;
    setBusy(true);
    const r = await apiCall<{ created: number; failed: number }>("POST", "/api/v1/imports", { action: "commit", merchantId, rows: valid });
    setBusy(false);
    if (r.ok && r.data) { setMsg(`✅ اتعملت ${r.data.created} شحنة · فشل ${r.data.failed}`); setText(""); setRows([]); setResults(null); }
    else setMsg(r.error?.message ?? "فشل");
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    f.text().then(setText);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 940, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 0.3rem", fontSize: "1.15rem" }}>استيراد شحنات بالجملة</h2>
        <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.83rem" }}>الأعمدة بالترتيب: <b>الاسم، الموبايل، المحافظة، العنوان، التحصيل، رقم الطلب</b> — الصق من Excel أو ارفع CSV.</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <select className="input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} style={{ flex: "1 1 200px" }}>
            <option value="">— اختار التاجر —</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.name_ar} ({m.code})</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile} style={{ display: "none" }} />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>📄 رفع CSV</button>
        </div>

        <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} rows={8} dir="rtl"
          placeholder={"أحمد، 01012345678، القاهرة، المعادي، 500، ORD-1\nمنى، 01087654321، الإسكندرية، سموحة، 300"} style={{ fontFamily: "monospace", fontSize: "0.82rem", marginBottom: 10 }} />

        {msg && <div style={{ marginBottom: 10, fontWeight: 600, fontSize: "0.88rem", color: "var(--color-orange-600)" }}>{msg}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className="btn btn-primary" disabled={busy || !merchantId || !text.trim()} onClick={preview}>{busy ? "..." : "معاينة"}</button>
          {results && <button className="btn btn-primary" style={{ background: "var(--color-success)" }} disabled={busy || !results.some((r) => r.ok)} onClick={commit}>تنفيذ الصالح ({results.filter((r) => r.ok).length})</button>}
        </div>

        {results && (
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
              <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><th style={th}>#</th><th style={th}>الاسم</th><th style={th}>المحافظة</th><th style={th}>الحالة</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const res = results.find((x) => x.index === i);
                  return (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)", background: res?.ok ? undefined : "#dc262610" }}>
                      <td style={td}>{i + 1}</td><td style={td}>{r.recipientName || "—"}</td><td style={td}>{r.governorate || "—"}</td>
                      <td style={td}>{res?.ok ? <span style={{ color: "var(--color-success)", fontWeight: 700 }}>✓ صالح</span> : <span style={{ color: "var(--color-danger)", fontSize: "0.78rem" }}>{res?.errors.join(" · ")}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

const th: React.CSSProperties = { padding: "0.6rem 0.8rem", fontWeight: 700, fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "0.5rem 0.8rem", verticalAlign: "middle" };
