"use client";

/**
 * الأسعار والرسوم — المدير يعدّل سعر الشحن (منطقة×شريحة) وقيم الرسوم.
 * التعديل بيأثّر على الشحنات الجديدة بس (القديمة سعرها مثبّت).
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface Price { id: string; zone: string; tier: string; price: string; priceP: string }
interface Fee { id: string; code: string; nameAr: string; calcType: string; value: string; valueP: string; percentBp: number }
interface Data { prices: Price[]; fees: Fee[] }

const TIER_LABEL: Record<string, string> = { t1: "t1 (أقل من ١٠٠)", t2: "t2 (١٠٠–٤٠٠)", t3: "t3 (أكتر من ٤٠٠)" };

function toPounds(p: string): string {
  const v = BigInt(p || "0");
  return `${v / 100n}.${(v % 100n).toString().padStart(2, "0")}`;
}

export default function PricingPage() {
  const user = useCurrentUser();
  const [data, setData] = useState<Data | null>(null);
  const canEdit = user?.role === "super_admin" || user?.role === "branch_manager";

  const load = useCallback(async () => {
    const r = await apiCall<Data>("GET", "/api/v1/pricing");
    if (r.ok && r.data) setData(r.data);
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 0.3rem", fontSize: "1.15rem" }}>الأسعار والرسوم</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 1.25rem" }}>
          التعديل بيأثّر على الشحنات <b>الجديدة</b> بس — القديمة سعرها مثبّت وقت الإنشاء.
        </p>

        {!data ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>
        ) : (
          <>
            <h3 style={{ fontSize: "1rem", margin: "0 0 0.6rem" }}>💰 سعر الشحن (منطقة × شريحة)</h3>
            <div className="card" style={{ padding: "0.5rem 0.9rem", marginBottom: "1.5rem" }}>
              {data.prices.map((p, i) => (
                <EditRow key={p.id} label={`${p.zone} · ${TIER_LABEL[p.tier] ?? p.tier}`} valueP={p.priceP}
                  canEdit={canEdit} first={i === 0}
                  onSave={(v) => apiCall("PATCH", "/api/v1/pricing", { kind: "price", id: p.id, value: v }).then((r) => r.ok)} />
              ))}
            </div>

            <h3 style={{ fontSize: "1rem", margin: "0 0 0.6rem" }}>🧾 الرسوم</h3>
            <div className="card" style={{ padding: "0.5rem 0.9rem" }}>
              {data.fees.map((f, i) => (
                <EditRow key={f.id} label={`${f.nameAr}`} valueP={f.valueP}
                  hint={f.percentBp > 0 ? `+ ${f.percentBp / 100}% نسبة` : undefined}
                  canEdit={canEdit} first={i === 0}
                  onSave={(v) => apiCall("PATCH", "/api/v1/pricing", { kind: "fee", id: f.id, value: v }).then((r) => r.ok)} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function EditRow({ label, valueP, hint, canEdit, first, onSave }: {
  label: string; valueP: string; hint?: string; canEdit: boolean; first: boolean; onSave: (v: string) => Promise<boolean>;
}) {
  const [v, setV] = useState(toPounds(valueP));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = v !== toPounds(valueP);

  async function save() {
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return;
    setBusy(true); setSaved(false);
    const okr = await onSave(v);
    setBusy(false);
    if (okr) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.6rem 0", borderTop: first ? 0 : "1px solid var(--border)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{label}</div>
        {hint && <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{hint}</div>}
      </div>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} disabled={!canEdit || busy}
        inputMode="decimal" dir="ltr" style={{ width: 100, textAlign: "right" }} />
      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>ج</span>
      {canEdit && (
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}
          style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem", opacity: dirty ? 1 : 0.4 }}>
          {busy ? "..." : saved ? "✓" : "حفظ"}
        </button>
      )}
    </div>
  );
}
