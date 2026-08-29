"use client";

/**
 * محطة المسح — فرز/استلام الوارد بالباركود.
 * الحقل دايمًا مركّز، فيدباك بصري ضخم (أخضر/أحمر)، عدّاد حي.
 * الماسح بيكتب البوليصة + Enter → استلام في المخزن.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface ScanResult {
  ok: boolean; rejected: boolean; reason: string | null; awb: string;
  recipientName: string | null; governorate: string | null; merchant: string | null;
  status: string | null; already: boolean;
}
type Tone = "ok" | "already" | "fail";
function toneOf(r: ScanResult): Tone { return r.rejected ? "fail" : r.already ? "already" : "ok"; }
const TONE_BG: Record<Tone, string> = { ok: "#16a34a", already: "#d97706", fail: "#dc2626" };
const TONE_ICON: Record<Tone, string> = { ok: "✓", already: "↺", fail: "✕" };

export default function ScanPage() {
  const user = useCurrentUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [awb, setAwb] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<ScanResult[]>([]);
  const [counts, setCounts] = useState({ total: 0, received: 0, rejected: 0 });

  const focus = useCallback(() => inputRef.current?.focus(), []);
  useEffect(() => { if (user) focus(); }, [user, focus]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const code = awb.trim();
    if (!code || busy) return;
    setBusy(true);
    const r = await apiCall<ScanResult>("POST", "/api/v1/scan", { awb: code, scanType: "inbound" });
    setBusy(false);
    setAwb("");
    focus();
    if (r.ok && r.data) {
      const res = r.data;
      setLast(res);
      setRecent((p) => [res, ...p].slice(0, 12));
      setCounts((c) => ({
        total: c.total + 1,
        received: c.received + (res.ok && !res.already ? 1 : 0),
        rejected: c.rejected + (res.rejected ? 1 : 0),
      }));
    } else {
      const res: ScanResult = { ok: false, rejected: true, reason: r.error?.message ?? "فشل المسح", awb: code, recipientName: null, governorate: null, merchant: null, status: null, already: false };
      setLast(res);
      setRecent((p) => [res, ...p].slice(0, 12));
      setCounts((c) => ({ ...c, total: c.total + 1, rejected: c.rejected + 1 }));
    }
  }

  if (!user) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  const tone = last ? toneOf(last) : null;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem" }}>محطة المسح — استلام الوارد</h2>
          <div style={{ display: "flex", gap: 16, fontSize: "0.85rem" }}>
            <span style={{ color: "var(--muted)" }}>الكل <b style={{ color: "var(--text)" }}>{counts.total}</b></span>
            <span style={{ color: "var(--color-success)" }}>مستلم <b>{counts.received}</b></span>
            <span style={{ color: "var(--color-danger)" }}>مرفوض <b>{counts.rejected}</b></span>
          </div>
        </div>

        {/* حقل المسح */}
        <form onSubmit={submit}>
          <input
            ref={inputRef}
            value={awb}
            onChange={(e) => setAwb(e.target.value)}
            onBlur={() => setTimeout(focus, 60)}
            placeholder="امسح البوليصة هنا…"
            autoFocus
            dir="ltr"
            style={{
              width: "100%", padding: "1.1rem 1.25rem", fontSize: "1.6rem", fontWeight: 800,
              textAlign: "center", borderRadius: 14, border: "2px solid var(--color-orange-500)",
              background: "var(--surface)", color: "var(--text)", letterSpacing: "0.05em", fontFamily: "monospace",
            }}
          />
        </form>

        {/* الفيدباك الضخم */}
        <div style={{
          marginTop: "1.25rem", borderRadius: 16, padding: "1.75rem",
          background: tone ? TONE_BG[tone] : "var(--surface)",
          color: tone ? "#fff" : "var(--muted)",
          minHeight: 150, display: "grid", placeItems: "center", textAlign: "center",
          transition: "background 0.1s",
        }}>
          {!last ? (
            <span>ابدأ المسح…</span>
          ) : (
            <div>
              <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1 }}>{TONE_ICON[tone!]}</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 800, fontFamily: "monospace", marginTop: 6 }}>{last.awb}</div>
              {last.rejected ? (
                <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: 6 }}>{last.reason}</div>
              ) : (
                <div style={{ marginTop: 8, fontSize: "1rem" }}>
                  <div style={{ fontWeight: 800 }}>{last.already ? "مستلمة قبل كده ↺" : "تم الاستلام في المخزن ✓"}</div>
                  <div style={{ opacity: 0.9, marginTop: 4 }}>{last.recipientName} · {last.governorate} · {last.merchant}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* آخر المسحات */}
        {recent.length > 0 && (
          <div className="card" style={{ marginTop: "1.25rem", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <tbody>
                {recent.map((r, i) => {
                  const t = toneOf(r);
                  return (
                    <tr key={i} style={{ borderTop: i ? "1px solid var(--border)" : "none" }}>
                      <td style={{ padding: "0.55rem 0.85rem", width: 34 }}><span style={{ color: TONE_BG[t], fontWeight: 900 }}>{TONE_ICON[t]}</span></td>
                      <td style={{ padding: "0.55rem 0.85rem", fontFamily: "monospace", fontWeight: 700 }}>{r.awb}</td>
                      <td style={{ padding: "0.55rem 0.85rem", color: "var(--muted)" }}>{r.rejected ? r.reason : `${r.recipientName ?? ""} · ${r.governorate ?? ""}`}</td>
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
