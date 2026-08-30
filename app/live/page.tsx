"use client";

/**
 * الخريطة الحية للمناديب — آخر موقع GPS لكل مندوب حاضر + عهدته.
 * (روابط OpenStreetMap — بدون مكتبة خرائط ثقيلة.)
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface Live { id: string; full_name: string; lat: number | null; lng: number | null; recorded_at: string | null; on_shift: boolean | null; in_hand: number }

function ago(iso: string | null): string {
  if (!iso) return "مفيش موقع";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `من ${mins} دقيقة`;
  return `من ${Math.floor(mins / 60)} ساعة`;
}

export default function LivePage() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<Live[]>([]);
  const load = useCallback(async () => { const r = await apiCall<{ couriers: Live[] }>("GET", "/api/v1/reports/couriers-live"); if (r.ok && r.data) setRows(r.data.couriers); }, []);
  useEffect(() => { if (user) { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); } }, [user, load]);
  if (!user) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  const withLoc = rows.filter((r) => r.lat != null);
  const allLink = withLoc.length > 0 ? `https://www.openstreetmap.org/#map=12/${withLoc[0]!.lat}/${withLoc[0]!.lng}` : null;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "1.25rem" }}>
        <WorkHoursConfig canEdit={user.role === "super_admin" || user.role === "branch_manager"} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem" }}>المناديب على الخريطة</h2>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>بيتحدّث كل ٣٠ ثانية · {withLoc.length} بموقع</span>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {rows.length === 0 ? <div className="card" style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش مناديب</div> :
           rows.map((c) => (
            <div key={c.id} className="card" style={{ padding: "0.9rem 1.1rem", display: "flex", alignItems: "center", gap: 12, borderInlineStart: `4px solid ${c.on_shift ? "var(--color-success)" : "var(--border)"}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800 }}>{c.full_name} {c.on_shift ? <span style={{ color: "var(--color-success)", fontSize: "0.75rem" }}>● حاضر</span> : <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>غير متواجد</span>}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{c.in_hand} شحنة في العهدة · آخر موقع {ago(c.recorded_at)}</div>
              </div>
              {c.lat != null ? (
                <a href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=15/${c.lat}/${c.lng}`} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ padding: "0.4rem 0.9rem", fontSize: "0.82rem" }}>📍 الخريطة</a>
              ) : <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>مفيش موقع</span>}
            </div>
          ))}
        </div>

        {allLink && <a href={allLink} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ marginTop: 16, display: "inline-block" }}>افتح المنطقة على الخريطة</a>}
      </main>
    </div>
  );
}

interface WorkHours { start: string | null; end: string | null; autoCheckout: boolean }

function WorkHoursConfig({ canEdit }: { canEdit: boolean }) {
  const [w, setW] = useState<WorkHours>({ start: "", end: "", autoCheckout: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiCall<WorkHours>("GET", "/api/v1/settings/work-hours").then((r) => {
      if (r.ok && r.data) setW({ start: r.data.start ?? "", end: r.data.end ?? "", autoCheckout: r.data.autoCheckout });
    });
  }, []);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await apiCall("PATCH", "/api/v1/settings/work-hours", {
      start: w.start || null, end: w.end || null, autoCheckout: w.autoCheckout,
    });
    setBusy(false);
    setMsg(r.ok ? "اتحفظ ✅" : (r.error?.message ?? "فشل الحفظ"));
  }

  return (
    <div className="card" style={{ padding: "1rem 1.2rem", marginBottom: "1.25rem" }}>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>🕐 ساعات عمل المناديب</div>
      <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: 10 }}>
        التتبّع بيشتغل في النطاق ده. سيبهم فاضيين = تتبّع من الحضور للانصراف اليدوي.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label className="label">من</label>
          <input className="input" type="time" value={w.start ?? ""} disabled={!canEdit} onChange={(e) => setW({ ...w, start: e.target.value })} />
        </div>
        <div>
          <label className="label">إلى</label>
          <input className="input" type="time" value={w.end ?? ""} disabled={!canEdit} onChange={(e) => setW({ ...w, end: e.target.value })} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: canEdit ? "pointer" : "default", paddingBottom: 8 }}>
          <input type="checkbox" checked={w.autoCheckout} disabled={!canEdit} onChange={(e) => setW({ ...w, autoCheckout: e.target.checked })} style={{ width: 18, height: 18 }} />
          انصراف تلقائي بالنهاية
        </label>
        {canEdit && <button className="btn btn-primary" onClick={save} disabled={busy} style={{ marginInlineStart: "auto" }}>{busy ? "..." : "حفظ"}</button>}
        {msg && <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--color-success)" }}>{msg}</span>}
      </div>
    </div>
  );
}
