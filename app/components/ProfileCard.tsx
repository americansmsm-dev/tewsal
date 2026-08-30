"use client";

/**
 * بطاقة بروفايل احترافية مشتركة (مندوب/تاجر/مدير):
 *  صورة قابلة للرفع + الاسم + الدور + الموبايل + عنوان قابل للتعديل.
 */
import { useEffect, useRef, useState } from "react";
import { apiCall, uploadAvatar } from "../lib/client";

interface Profile { fullName: string; roleLabel: string; phone: string | null; address: string | null; avatarViewUrl: string | null; }

export function ProfileCard({ subtitle, logout }: { subtitle?: string; logout: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [address, setAddress] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiCall<Profile>("GET", "/api/v1/profile").then((r) => {
      if (r.ok && r.data) { setP(r.data); setAddress(r.data.address ?? ""); setAvatar(r.data.avatarViewUrl); }
    });
  }, []);

  async function saveAddress() {
    setBusy(true); setMsg(null);
    const r = await apiCall("PATCH", "/api/v1/profile", { address });
    setBusy(false);
    setMsg(r.ok ? "اتحفظ ✅" : (r.error?.message ?? "فشل الحفظ"));
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg(null);
    try { const url = await uploadAvatar(file); if (url) setAvatar(url); setMsg("الصورة اتحدّثت ✅"); }
    catch (err) { setMsg(err instanceof Error ? err.message : "فشل رفع الصورة"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  if (!p) return <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: "1.3rem", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => fileRef.current?.click()} disabled={busy} title="غيّر الصورة"
          style={{ width: 72, height: 72, borderRadius: "50%", border: "2px solid var(--color-orange-500)", overflow: "hidden", padding: 0, cursor: "pointer", background: "var(--color-orange-500)", color: "#fff", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
          {avatar ? <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "1.7rem", fontWeight: 800 }}>{p.fullName.trim().charAt(0)}</span>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onPickAvatar} style={{ display: "none" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{p.fullName}</div>
          <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{subtitle ?? p.roleLabel}</div>
          {p.phone && <div dir="ltr" style={{ fontSize: "0.82rem", color: "var(--muted)", textAlign: "right" }}>{p.phone}</div>}
          <button onClick={() => fileRef.current?.click()} className="btn btn-ghost" style={{ padding: "0.2rem 0.6rem", fontSize: "0.75rem", marginTop: 4 }}>📷 غيّر الصورة</button>
        </div>
      </div>

      <div className="card" style={{ padding: "1rem 1.2rem" }}>
        <label className="label">العنوان</label>
        <textarea className="input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان بالتفصيل" style={{ width: "100%" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <button className="btn btn-primary" onClick={saveAddress} disabled={busy}>{busy ? "..." : "حفظ"}</button>
          {msg && <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--color-success)" }}>{msg}</span>}
        </div>
      </div>

      <button className="btn btn-ghost" style={{ padding: "0.85rem", color: "var(--color-danger)", borderColor: "var(--color-danger)" }} onClick={logout}>تسجيل الخروج</button>
    </div>
  );
}
