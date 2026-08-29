"use client";

/**
 * الأمان — المصادقة الثنائية للمستخدم + وضع الطوارئ (تجميد التسويات).
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

export default function SecurityPage() {
  const user = useCurrentUser();
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadEmergency = useCallback(async () => { const r = await apiCall<{ frozen: boolean }>("GET", "/api/v1/security/emergency"); if (r.ok && r.data) setFrozen(r.data.frozen); }, []);
  useEffect(() => { if (user) loadEmergency(); }, [user, loadEmergency]);
  if (!user) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
  const canEmergency = ["super_admin", "branch_manager"].includes(user.role);

  async function toggleEmergency(on: boolean) {
    setErr(null);
    const r = await apiCall<{ frozen: boolean }>("POST", "/api/v1/security/emergency", { on });
    if (r.ok && r.data) setFrozen(r.data.frozen); else setErr(r.error?.message ?? "فشل");
  }
  async function do2fa(action: string, extra: Record<string, unknown> = {}) {
    setErr(null); setMsg(null);
    const r = await apiCall<{ secret: string; uri: string; enabled?: boolean; disabled?: boolean }>("POST", "/api/v1/auth/2fa", { action, ...extra });
    if (!r.ok) { setErr(r.error?.message ?? "فشل"); return; }
    if (action === "setup" && r.data) setSetup({ secret: r.data.secret, uri: r.data.uri });
    if (action === "enable") { setSetup(null); setCode(""); setMsg("✅ اتفعّلت المصادقة الثنائية"); }
    if (action === "disable") { setSetup(null); setMsg("اتوقفت المصادقة الثنائية"); }
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "1.25rem", display: "grid", gap: "1.25rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.15rem" }}>الأمان</h2>
        {msg && <div style={{ color: "var(--color-success)", fontWeight: 700, fontSize: "0.9rem" }}>{msg}</div>}
        {err && <ErrorBox msg={err} />}

        {/* 2FA */}
        <div className="card" style={{ padding: "1.2rem 1.35rem" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>🔐 المصادقة الثنائية (2FA)</h3>
          <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.85rem" }}>طبقة حماية زيادة على حسابك — كود من تطبيق Google Authenticator وقت الدخول.</p>
          {!setup ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => do2fa("setup")}>تفعيل / إعادة إعداد</button>
              <button className="btn btn-ghost" onClick={() => do2fa("disable")}>إيقاف</button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: "0.83rem", marginBottom: 8 }}>١) أضف الحساب في تطبيق المصادقة — امسح الكود أو أدخل السر يدوي:</p>
              <div style={{ fontFamily: "monospace", fontSize: "0.9rem", padding: "0.6rem 0.9rem", background: "var(--bg-soft)", borderRadius: 8, wordBreak: "break-all", marginBottom: 8 }}>{setup.secret}</div>
              <p style={{ fontSize: "0.83rem", marginBottom: 8 }}>٢) اكتب الكود اللي ظهر لتأكيد التفعيل:</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" dir="ltr" style={{ textAlign: "center", maxWidth: 160, letterSpacing: 4, fontSize: "1.1rem" }} placeholder="000000" />
                <button className="btn btn-primary" disabled={code.length !== 6} onClick={() => do2fa("enable", { code })}>تأكيد</button>
                <button className="btn btn-ghost" onClick={() => setSetup(null)}>إلغاء</button>
              </div>
            </div>
          )}
        </div>

        {/* وضع الطوارئ */}
        {canEmergency && (
          <div className="card" style={{ padding: "1.2rem 1.35rem", borderInlineStart: `4px solid ${frozen ? "var(--color-danger)" : "var(--border)"}` }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>🚨 وضع الطوارئ</h3>
            <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.85rem" }}>لما يتفعّل، <b>كل دفعات التسويات بتتجمّد</b> فورًا لحد ما تقفله — للاستخدام وقت الاشتباه في مشكلة مالية.</p>
            {frozen === null ? <span style={{ color: "var(--muted)" }}>...</span> : frozen ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "var(--color-danger)", fontWeight: 800 }}>● مفعّل — التسويات متجمّدة</span>
                <button className="btn btn-primary" onClick={() => toggleEmergency(false)}>إلغاء التجميد</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "var(--muted)" }}>الوضع طبيعي</span>
                <button className="btn btn-ghost" style={{ color: "var(--color-danger)" }} onClick={() => toggleEmergency(true)}>تفعيل الطوارئ</button>
              </div>
            )}
          </div>
        )}

        <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>الصلاحيات الدقيقة لكل مستخدم بتتدار من صفحة الفريق.</p>
      </main>
    </div>
  );
}
