"use client";

/**
 * لوحة محفظة التاجر — الرصيد المتاح/المحجوز + شحن المحفظة.
 * بتظهر في صفحة التاجر (الإدارة) وبوابة التاجر (عرض فقط).
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall } from "../lib/client";

interface Balance { ledgerP: string; reservedP: string; availableP: string }

function egp(p: string): string {
  const v = BigInt(p || "0");
  const neg = v < 0n; const a = neg ? -v : v;
  return `${neg ? "-" : ""}${(a / 100n).toLocaleString("en-US")}.${(a % 100n).toString().padStart(2, "0")} ج`;
}

export function WalletPanel({ merchantId, canDeposit }: { merchantId: string; canDeposit: boolean }) {
  const [bal, setBal] = useState<Balance | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await apiCall<Balance>("GET", `/api/v1/merchants/${merchantId}/wallet`);
    if (r.ok) setBal(r.data);
  }, [merchantId]);

  useEffect(() => { load(); }, [load]);

  async function deposit() {
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) { setMsg({ kind: "err", text: "اكتب مبلغ صحيح" }); return; }
    setBusy(true); setMsg(null);
    const r = await apiCall<Balance>("POST", `/api/v1/merchants/${merchantId}/wallet`, { amount, method });
    setBusy(false);
    if (r.ok && r.data) { setBal(r.data); setAmount(""); setMsg({ kind: "ok", text: "المحفظة اتشحنت" }); }
    else setMsg({ kind: "err", text: r.error?.message ?? "فشل الشحن" });
  }

  return (
    <div className="card" style={{ marginBottom: "1.25rem", padding: "1rem 1.1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: "1.05rem" }}>👛</span>
        <b style={{ fontSize: "1rem" }}>محفظة التاجر</b>
        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          (بتغطّي شحن الأوردرات اللي من غير تحصيل)
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: canDeposit ? 12 : 0 }}>
        <Stat label="المتاح للشحن" value={bal ? egp(bal.availableP) : "—"} strong />
        <Stat label="محجوز في الطريق" value={bal ? egp(bal.reservedP) : "—"} />
        <Stat label="إجمالي الرصيد" value={bal ? egp(bal.ledgerP) : "—"} />
      </div>
      {canDeposit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input" placeholder="المبلغ بالجنيه" value={amount}
            onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
            style={{ width: 140 }}
          />
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 130 }}>
            <option value="cash">كاش</option>
            <option value="instapay">إنستاباي</option>
            <option value="vodafone_cash">فودافون كاش</option>
            <option value="bank">تحويل بنكي</option>
          </select>
          <button className="btn btn-primary" onClick={deposit} disabled={busy}>
            {busy ? "..." : "اشحن المحفظة"}
          </button>
          {msg && (
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: msg.kind === "ok" ? "var(--color-success)" : "var(--color-danger)" }}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "0.6rem 0.7rem" }}>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: strong ? "1.15rem" : "1rem", fontWeight: 800, color: strong ? "var(--color-orange-600)" : "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}
