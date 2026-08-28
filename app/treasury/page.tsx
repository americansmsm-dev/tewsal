"use client";

/**
 * لوحة الخزينة — أرصدة الكاش لحظيًا + استلام عهد المناديب.
 * استلام العهدة بيحوّل الكاش من «تحت التحصيل» لـ «مؤكد» عند التجار.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface CourierCash {
  courierId: string;
  name: string;
  balance: string;
  balanceP: string;
  oldest: string | null;
}
interface Treasury {
  couriers: CourierCash[];
  accounts: {
    courierCashTotal: string;
    bank: string;
    vodafone: string;
    instapay: string;
    suspense: string;
  };
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function TreasuryPage() {
  const user = useCurrentUser();
  const [data, setData] = useState<Treasury | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<CourierCash | null>(null);

  const load = useCallback(async () => {
    const r = await apiCall<Treasury>("GET", "/api/v1/treasury");
    if (r.ok) setData(r.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!user) return <Loading />;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.15rem" }}>الخزينة</h2>

        {/* أرصدة الحسابات */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: "1.5rem" }}>
          <Stat label="كاش مع المناديب" value={data?.accounts.courierCashTotal} tone="warn" />
          <Stat label="البنك" value={data?.accounts.bank} tone="success" />
          <Stat label="فودافون كاش" value={data?.accounts.vodafone} />
          <Stat label="إنستاباي" value={data?.accounts.instapay} />
          <Stat label="زيادة معلّقة" value={data?.accounts.suspense} tone="muted" />
        </div>

        <h3 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>عهد المناديب</h3>
        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>المندوب</Th>
                <Th>الكاش في العهدة</Th>
                <Th>من زمان</Th>
                <Th>استلام</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
              ) : !data || data.couriers.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش مناديب ماسكين كاش دلوقتي</td></tr>
              ) : (
                data.couriers.map((c) => {
                  const days = daysSince(c.oldest);
                  return (
                    <tr key={c.courierId} style={{ borderTop: "1px solid var(--border)" }}>
                      <Td><span style={{ fontWeight: 700 }}>{c.name}</span></Td>
                      <Td><span style={{ fontWeight: 800, color: "var(--color-warning)" }}>{c.balance}</span></Td>
                      <Td>
                        <span style={{ color: days >= 2 ? "var(--color-danger)" : "var(--muted)", fontWeight: days >= 2 ? 700 : 400 }}>
                          {days === 0 ? "النهاردة" : `${days} يوم`}
                          {days >= 2 ? " ⚠" : ""}
                        </span>
                      </Td>
                      <Td>
                        <button className="btn btn-primary" style={{ padding: "0.3rem 0.8rem", fontSize: "0.8rem" }} onClick={() => setActive(c)}>
                          استلام العهدة
                        </button>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {active && (
        <HandoverModal
          courier={active}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function HandoverModal({ courier, onClose, onDone }: { courier: CourierCash; onClose: () => void; onDone: () => void }) {
  const [received, setReceived] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const expected = courier.balance;
  const receivedNum = parseFloat(received || "0");
  const expectedNum = Number(BigInt(courier.balanceP)) / 100;
  const variance = receivedNum - expectedNum;
  const hasShortage = received !== "" && variance < 0;

  async function submit() {
    setError(null);
    setBusy(true);
    const body: Record<string, unknown> = { courierId: courier.courierId, received };
    if (note) body.varianceNote = note;
    const r = await apiCall("POST", "/api/v1/handovers", body);
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error?.message ?? "فشل تسليم العهدة");
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>استلام عهدة {courier.name}</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        المتوقع حسب الدفتر: <b style={{ color: "var(--text)" }}>{expected}</b>
      </div>

      <label className="label">المبلغ المعدود فعلًا (ج)</label>
      <input
        className="input"
        value={received}
        onChange={(e) => setReceived(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        style={{ textAlign: "right", fontSize: "1.1rem", fontWeight: 700 }}
        placeholder="0.00"
        autoFocus
      />

      {received !== "" && Math.abs(variance) > 0.001 && (
        <div
          style={{
            marginTop: 10,
            padding: "0.6rem 0.8rem",
            borderRadius: 10,
            fontSize: "0.85rem",
            fontWeight: 700,
            background: variance < 0 ? "#dc262618" : "#d9770618",
            color: variance < 0 ? "var(--color-danger)" : "var(--color-warning)",
          }}
        >
          {variance < 0
            ? `⚠ عجز ${Math.abs(variance).toFixed(2)} ج — هيتحوّل ذمة على المندوب`
            : `زيادة ${variance.toFixed(2)} ج — هتتسجّل معلّقة لحد ما نعرف مصدرها`}
        </div>
      )}

      {hasShortage && (
        <div style={{ marginTop: 10 }}>
          <label className="label">سبب العجز (إجباري)</label>
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
      )}

      {error && <div style={{ marginTop: 10 }}><ErrorBox msg={error} /></div>}

      <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={busy || received === "" || (hasShortage && !note.trim())}
          onClick={submit}
        >
          {busy ? "جاري..." : "تأكيد الاستلام"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | undefined; tone?: "warn" | "success" | "muted" }) {
  const color = tone === "warn" ? "var(--color-warning)" : tone === "success" ? "var(--color-success)" : tone === "muted" ? "var(--muted)" : "var(--text)";
  return (
    <div className="card" style={{ padding: "0.9rem 1rem" }}>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 800, color }}>{value ?? "—"}</div>
    </div>
  );
}
function Loading() {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.78rem", color: "var(--muted)" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.7rem 0.85rem", verticalAlign: "middle" }}>{children}</td>;
}
