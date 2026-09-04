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
    branchCash: string;
    courierCashTotal: string;
    bank: string;      // شامل الإنستاباي
    bankOnly: string;
    vodafone: string;
    instapay: string;
    wallets: string;
    suspense: string;
    total: string;
  };
}
interface Deduction {
  id: string;
  courier_name: string | null;
  amount: string;
  reason_ar: string;
  status: string;
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
  const [depositOpen, setDepositOpen] = useState(false);
  const [deductions, setDeductions] = useState<Deduction[]>([]);

  const load = useCallback(async () => {
    const r = await apiCall<Treasury>("GET", "/api/v1/treasury");
    if (r.ok) setData(r.data);
    const d = await apiCall<{ deductions: Deduction[] }>("GET", "/api/v1/deductions?status=pending");
    if (d.ok && d.data) setDeductions(d.data.deductions);
    setLoading(false);
  }, []);

  async function waive(id: string) {
    if (!confirm("إعفاء المندوب من الخصم؟ الخسارة هتتكتب على الشركة.")) return;
    const r = await apiCall("POST", `/api/v1/deductions/${id}/waive`);
    if (!r.ok) alert(r.error?.message ?? "فشل الإعفاء");
    load();
  }

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!user) return <Loading />;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem" }}>الخزينة</h2>
          <button className="btn btn-primary" type="button" onClick={() => setDepositOpen(true)}>إيداع بنكي</button>
        </div>

        {/* إجمالي فلوس الشركة — الرقم الأهم */}
        <div className="card" style={{ padding: "1rem 1.2rem", marginBottom: "0.9rem", minWidth: 0 }}>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>💰 إجمالي فلوس الشركة دلوقتي</div>
          <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "var(--color-orange-600)", lineHeight: 1.2, wordBreak: "break-word" }}>
            {data?.accounts.total ?? "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 3 }}>
            الخزنة + مع المناديب + البنك (شامل إنستاباي) + فودافون كاش
          </div>
        </div>

        {/* فلوسك فين بالظبط */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 10, marginBottom: "1.5rem", minWidth: 0 }}>
          <Stat label="🏢 كاش خزنة الشركة" value={data?.accounts.branchCash} tone="success" />
          <Stat label="🛵 كاش مع المناديب" value={data?.accounts.courierCashTotal} tone="warn" />
          <Stat label="🏦 الحساب البنكي (شامل إنستاباي)" value={data?.accounts.bank} tone="success" />
          <Stat label="📱 فودافون كاش" value={data?.accounts.vodafone} />
          <Stat label="زيادة معلّقة (مش مضافة للإجمالي)" value={data?.accounts.suspense} tone="muted" />
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

        {/* خصومات المناديب (عجز العهد) */}
        {deductions.length > 0 && (
          <>
            <h3 style={{ fontSize: "1rem", margin: "1.75rem 0 0.75rem" }}>خصومات المناديب (عجز)</h3>
            <div className="card" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                    <Th>المندوب</Th><Th>المبلغ</Th><Th>السبب</Th><Th>إجراء</Th>
                  </tr>
                </thead>
                <tbody>
                  {deductions.map((d) => (
                    <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <Td><span style={{ fontWeight: 700 }}>{d.courier_name ?? "—"}</span></Td>
                      <Td><span style={{ fontWeight: 800, color: "var(--color-danger)" }}>{d.amount}</span></Td>
                      <Td><span style={{ color: "var(--muted)" }}>{d.reason_ar}</span></Td>
                      <Td><button className="btn btn-ghost" style={{ padding: "0.3rem 0.8rem", fontSize: "0.8rem" }} onClick={() => waive(d.id)}>إعفاء</button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
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
      {depositOpen && (
        <BankDepositModal
          bankBalance={data?.accounts.bank ?? "—"}
          onClose={() => setDepositOpen(false)}
          onDone={() => { setDepositOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function BankDepositModal({ bankBalance, onClose, onDone }: { bankBalance: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null); setBusy(true);
    const body: Record<string, unknown> = { amount };
    if (receipt) body.receiptNo = receipt;
    const r = await apiCall("POST", "/api/v1/bank-deposits", body);
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error?.message ?? "فشل الإيداع");
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>إيداع بنكي من الخزنة</h3>
      <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        رصيد البنك الحالي: <b style={{ color: "var(--text)" }}>{bankBalance}</b>
      </div>
      <label className="label">المبلغ المودَع (ج)</label>
      <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" style={{ textAlign: "right", fontSize: "1.1rem", fontWeight: 700 }} placeholder="0.00" autoFocus />
      <label className="label" style={{ marginTop: 10 }}>رقم الإيصال (اختياري)</label>
      <input className="input" value={receipt} onChange={(e) => setReceipt(e.target.value)} />
      {error && <div style={{ marginTop: 10 }}><ErrorBox msg={error} /></div>}
      <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !amount} onClick={submit}>{busy ? "جاري..." : "تأكيد الإيداع"}</button>
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Overlay>
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
  // رقم سالب دايمًا أحمر — أخضر على رصيد بالسالب بيضلّل
  const negative = !!value && /[-−]/.test(value);
  const color = negative
    ? "var(--color-danger)"
    : tone === "warn" ? "var(--color-warning)" : tone === "success" ? "var(--color-success)" : tone === "muted" ? "var(--muted)" : "var(--text)";
  return (
    <div className="card" style={{ padding: "0.9rem 1rem", minWidth: 0 }}>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 800, color, wordBreak: "break-word" }}>{value ?? "—"}</div>
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
