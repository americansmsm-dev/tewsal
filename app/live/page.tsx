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
