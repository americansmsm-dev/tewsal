"use client";

/**
 * الوارد للمخزن — استلام الطرود من المناديب.
 * مسؤول المخزن (العمليات) والأدمن بس بيشوفوا الشحنات اللي المناديب
 * استلموها من التجار (picked_up) ولسه في عهدتهم، ويأكّدوا استلامها
 * على السيستم (picked_up → at_hub). طريقتين: تأكيد مباشر، أو بصورة.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { TransitionModal } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall, toArabicDigits, type Role } from "../lib/client";

interface Parcel {
  id: string;
  awb: string;
  status: "picked_up";
  recipient_name: string;
  merchant_name?: string;
  governorate: string;
  cod_amount_p: string;
  current_courier_id: string | null;
  courier_name?: string;
}

const CAN_RECEIVE = ["super_admin", "branch_manager", "ops"];

export default function ReceivingPage() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Parcel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall<{ shipments: Parcel[] }>("GET", "/api/v1/shipments?status=picked_up&limit=300");
    if (r.ok && r.data) setRows(r.data.shipments);
    setLoading(false);
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
  const canReceive = CAN_RECEIVE.includes(user.role);

  async function receiveOne(id: string): Promise<boolean> {
    const r = await apiCall("POST", `/api/v1/shipments/${id}/transitions`, {
      to: "at_hub", expectedStatus: "picked_up", deviceEventId: crypto.randomUUID(),
    });
    return r.ok;
  }
  async function receive(id: string) {
    setErr(null); setBusy(id);
    const ok = await receiveOne(id);
    setBusy(null);
    if (ok) load(); else setErr("تعذّر استلام الشحنة — حدّث الصفحة وحاول تاني");
  }
  async function receiveGroup(ids: string[]) {
    setErr(null); setBusy("group");
    for (const id of ids) await receiveOne(id);
    setBusy(null); load();
  }

  // تجميع حسب المندوب
  const groups = new Map<string, Parcel[]>();
  for (const p of rows) {
    const key = p.courier_name ?? "غير محدّد";
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(p);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem" }}>الوارد من المناديب</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
            الطرود اللي المناديب استلموها من التجار ولسه في عهدتهم. أكّد استلامها في المخزن —
            <b> تأكيد مباشر</b> أو <b>بصورة</b> (اختياري).
          </p>
        </div>

        {!canReceive && (
          <div className="card" style={{ padding: "1.5rem", textAlign: "center", color: "var(--muted)" }}>
            الاستلام متاح لمسؤول المخزن (العمليات) ومدير النظام بس.
          </div>
        )}

        {err && <div style={{ marginBottom: "0.9rem", padding: "0.7rem 0.9rem", borderRadius: 12, background: "#dc262618", border: "1px solid #dc262633", color: "#dc2626", fontWeight: 700, fontSize: "0.85rem" }}>⚠️ {err}</div>}

        {canReceive && (loading ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="card" style={{ padding: "2.5rem 1rem", textAlign: "center", color: "var(--muted)" }}>
            <div style={{ fontSize: "2.5rem" }}>📦</div>مفيش وارد من المناديب دلوقتي
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {[...groups.entries()].map(([courier, parcels]) => (
              <div key={courier} className="card" style={{ padding: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: "0.75rem", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>🛵 {courier} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: "0.82rem" }}>· {toArabicDigits(parcels.length)} شحنة</span></div>
                  <button className="btn btn-primary" style={{ padding: "0.45rem 1rem", fontSize: "0.82rem" }}
                    disabled={busy !== null}
                    onClick={() => receiveGroup(parcels.map((p) => p.id))}>
                    {busy === "group" ? "جاري الاستلام..." : "✅ استلم الكل"}
                  </button>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {parcels.map((p) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0.6rem 0.7rem", background: "var(--bg-soft)", borderRadius: 10, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{p.merchant_name ?? "—"} <span dir="ltr" style={{ color: "var(--muted)", fontWeight: 600, fontSize: "0.75rem" }}>{p.awb}</span></div>
                        <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>للعميل: {p.recipient_name} · {p.governorate}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                        <button className="btn btn-ghost" style={{ padding: "0.4rem 0.7rem", fontSize: "0.8rem" }} disabled={busy !== null} onClick={() => setPhoto(p)}>📷 بصورة</button>
                        <button className="btn btn-primary" style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem" }} disabled={busy !== null} onClick={() => receive(p.id)}>
                          {busy === p.id ? "..." : "✅ استلمت"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </main>

      {photo && (
        <TransitionModal
          shipmentId={photo.id}
          awb={photo.awb}
          currentStatus="picked_up"
          currentCourierId={photo.current_courier_id ?? ""}
          role={user.role as Role}
          onClose={() => setPhoto(null)}
          onDone={() => { setPhoto(null); load(); }}
        />
      )}
    </div>
  );
}
