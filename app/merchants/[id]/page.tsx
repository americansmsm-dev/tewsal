"use client";

/**
 * كشف حساب التاجر — الخانتين + ملخّص المكسب + حركات بتفصيل الممل + تشغيل تسوية.
 * ⚠️ الرقم «المؤكد» عمره ما يقل — ده جوهر الشفافية.
 * 🔒 أعمدة المكسب وعمولة المندوب بتبان للمالية بس (canSeeProfit من الـ API).
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { AppNav } from "../../components/AppNav";
import { useCurrentUser } from "../../lib/useCurrentUser";
import { apiCall } from "../../lib/client";
import { MerchantCrmPanel } from "../../components/MerchantCrmPanel";
import { WalletPanel } from "../../components/WalletPanel";
import { STATUS_LABELS_AR } from "@/server/domain/statusMachine";

interface Line {
  awb: string;
  status: string;
  kind: string;
  net: string;
  codCollected: string;
  shipping: string;
  otherFees: string;
  feesRevenue: string;
  recordedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  settled: boolean;
  // للمالية بس
  commission?: string;
  compensation?: string;
  profit?: string;
  profitP?: string;
}
interface Summary {
  ordersCount: number;
  codCollected: string;
  codCollectedP: string;
  feesRevenue?: string;
  codFeeSettlement?: string;
  commission?: string;
  compensation?: string;
  profit?: string;
  profitP?: string;
}
interface Statement {
  confirmed: string;
  inCollection: string;
  totalP: string;
  canSeeProfit: boolean;
  /** الفترة اللي التفاصيل والملخص محسوبين عليها (الافتراضي ٩٠ يوم) */
  period: { from: string; to: string; days: number };
  summary: Summary;
  lines: Line[];
}

const KIND_LABEL: Record<string, string> = {
  delivery: "تسليم",
  partial_delivery: "تسليم جزئي",
  return: "مرتجع",
  cancellation: "إلغاء",
};

function shortDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ar-EG", { day: "2-digit", month: "2-digit" });
}

export default function MerchantStatementPage() {
  const user = useCurrentUser();
  const params = useParams<{ id: string }>();
  const merchantId = params.id;
  const [st, setSt] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", `${to}T23:59:59`);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const r = await apiCall<Statement>("GET", `/api/v1/merchants/${merchantId}/statement${suffix}`);
    if (r.ok) setSt(r.data);
    setLoading(false);
  }, [merchantId, from, to]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function runSettlement() {
    setBusy(true);
    setMsg(null);
    const r = await apiCall<{ code: string; itemCount: number; netPayable: string }>(
      "POST",
      "/api/v1/settlements",
      { merchantId }
    );
    setBusy(false);
    if (r.ok && r.data) {
      setMsg({ kind: "ok", text: `اتعملت تسوية ${r.data.code} — ${r.data.itemCount} شحنة بصافي ${r.data.netPayable}` });
      load();
    } else {
      setMsg({ kind: "err", text: r.error?.message ?? "فشلت التسوية" });
    }
  }

  if (!user) return <Loading />;
  const canSettle = ["super_admin", "branch_manager", "accountant"].includes(user.role);
  const canSeeProfit = st?.canSeeProfit ?? false;
  const sm = st?.summary;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          <Link href="/merchants" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            → رجوع للتجار
          </Link>
          <h2 style={{ margin: "0.3rem 0 0", fontSize: "1.15rem" }}>كشف حساب التاجر</h2>
        </div>

        {/* الخانتين */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12, marginBottom: "1rem", minWidth: 0 }}>
          <BalanceCard title="✅ مؤكد وجاهز للتحويل" hint="الكاش وصل الشركة فعلًا — الرقم ده مضمون" value={st?.confirmed ?? "—"} tone="success" />
          <BalanceCard title="⏳ تحت التحصيل" hint="تم التسليم بس الكاش لسه مع المندوب" value={st?.inCollection ?? "—"} tone="warn" />
        </div>

        {/* 💰 ملخّص مكسبك من التاجر ده — للمالية بس */}
        {canSeeProfit && sm && (
          <div style={{ marginBottom: "1.25rem" }}>
            <h3 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>💰 مكسبك من التاجر ده</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: "0.7rem", minWidth: 0 }}>
              <Stat label="صافي مكسبك" value={sm.profit ?? "—"} tone={BigInt(sm.profitP ?? "0") >= 0n ? "good" : "bad"} note="الرسوم ناقص عمولة المندوب والتعويضات" />
              <Stat label="إجمالي الرسوم (إيرادك)" value={sm.feesRevenue ?? "—"} tone="accent" note="شحن + تحصيل + رسوم أخرى" />
              <Stat label="منها رسم التحصيل الأسبوعي" value={sm.codFeeSettlement ?? "—"} note="بيتخصم مرة أسبوعيًا عند التسوية" />
              <Stat label="عمولات المناديب" value={sm.commission ?? "—"} note="تكلفة على الشركة" />
              <Stat label="التعويضات" value={sm.compensation ?? "—"} note="مفقود/تالف" />
              <Stat label="المحصّل من العملاء" value={sm.codCollected} note={`${sm.ordersCount} أوردر إجمالًا`} />
            </div>
          </div>
        )}

        {/* فلتر الفترة */}
        <div className="card" style={{ padding: "0.7rem 0.9rem", marginBottom: "1rem", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 3 }}>من تاريخ</div>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" style={{ padding: "0.35rem 0.5rem" }} />
          </div>
          <div>
            <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 3 }}>لتاريخ</div>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" style={{ padding: "0.35rem 0.5rem" }} />
          </div>
          {/* اختصارات — الافتراضي ٩٠ يوم عشان الكشف مايقراش دفتر
              التاجر من أول يوم في كل فتحة صفحة */}
          {[30, 90, 180, 365].map((d) => (
            <button
              key={d}
              className="btn btn-ghost"
              onClick={() => {
                const now = new Date();
                const start = new Date(now.getTime() - d * 86400000);
                setFrom(start.toISOString().slice(0, 10));
                setTo(now.toISOString().slice(0, 10));
              }}
              style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem" }}
            >
              {d === 365 ? "سنة" : `${d} يوم`}
            </button>
          ))}
          {(from || to) && (
            <button className="btn btn-ghost" onClick={() => { setFrom(""); setTo(""); }} style={{ padding: "0.4rem 0.8rem", fontSize: "0.82rem" }}>
              الافتراضي
            </button>
          )}
          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            {st?.period
              ? `التفاصيل والملخص عن ${st.period.days} يوم — الرصيد لحظي مش متأثر بالفترة`
              : "آخر ٩٠ يوم"}
          </span>
        </div>

        {/* محفظة التاجر — الرصيد + الشحن */}
        <WalletPanel merchantId={merchantId} canDeposit={canSettle} />

        {canSettle && (
          <div style={{ marginBottom: "1rem" }}>
            <button className="btn btn-primary" onClick={runSettlement} disabled={busy}>
              {busy ? "جاري التسوية..." : "تشغيل تسوية للمؤكد"}
            </button>
            {msg && (
              <span style={{ marginInlineStart: 12, fontSize: "0.85rem", fontWeight: 600, color: msg.kind === "ok" ? "var(--color-success)" : "var(--color-danger)" }}>
                {msg.text}
              </span>
            )}
          </div>
        )}

        {canSettle && <MerchantCrmPanel merchantId={merchantId} />}

        {/* الحركات — تفصيل الممل */}
        <div className="card" style={{ overflowX: "auto", margin: "0 -0.35rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: canSeeProfit ? 940 : 720 }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>البوليصة</Th>
                <Th>النوع</Th>
                <Th>الحالة</Th>
                <Th>المحصّل</Th>
                <Th>الشحن</Th>
                <Th>رسوم أخرى</Th>
                <Th>إجمالي الرسوم</Th>
                <Th>صافي التاجر</Th>
                {canSeeProfit && <Th>عمولة المندوب</Th>}
                {canSeeProfit && <Th>مكسبك</Th>}
                <Th>الاستلام</Th>
                <Th>التسليم</Th>
                <Th>التسوية</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canSeeProfit ? 13 : 11} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
              ) : !st || st.lines.length === 0 ? (
                <tr><td colSpan={canSeeProfit ? 13 : 11} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش حركات مالية في الفترة دي</td></tr>
              ) : (
                st.lines.map((l, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td><span dir="ltr" style={{ fontWeight: 700 }}>{l.awb}</span></Td>
                    <Td>{KIND_LABEL[l.kind] ?? l.kind}</Td>
                    <Td><span style={{ color: "var(--muted)" }}>{STATUS_LABELS_AR[l.status as never] ?? l.status}</span></Td>
                    <Td>{l.codCollected}</Td>
                    <Td>{l.shipping}</Td>
                    <Td>{l.otherFees}</Td>
                    <Td><span style={{ fontWeight: 600 }}>{l.feesRevenue}</span></Td>
                    <Td><span style={{ fontWeight: 700 }}>{l.net}</span></Td>
                    {canSeeProfit && <Td><span style={{ color: "var(--color-warning)" }}>{l.commission}</span></Td>}
                    {canSeeProfit && (
                      <Td><span style={{ fontWeight: 800, color: BigInt(l.profitP ?? "0") >= 0n ? "var(--color-success)" : "var(--color-danger)" }}>{l.profit}</span></Td>
                    )}
                    <Td><span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{shortDate(l.pickedUpAt)}</span></Td>
                    <Td><span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{shortDate(l.deliveredAt)}</span></Td>
                    <Td>
                      {l.settled ? (
                        <span className="badge" style={{ color: "var(--color-success)" }}>محوّلة</span>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>لسه</span>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function BalanceCard({ title, hint, value, tone }: { title: string; hint: string; value: string; tone: "success" | "warn" }) {
  const color = tone === "success" ? "var(--color-success)" : "var(--color-warning)";
  return (
    <div className="card" style={{ padding: "1.1rem 1.25rem", borderTop: `3px solid ${color}`, minWidth: 0 }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: "1.7rem", fontWeight: 800, color, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 6 }}>{hint}</div>
    </div>
  );
}

function Stat({ label, value, tone, note }: { label: string; value: string; tone?: "good" | "bad" | "accent"; note?: string }) {
  const color = tone === "good" ? "var(--color-success)" : tone === "bad" ? "var(--color-danger)" : tone === "accent" ? "var(--color-orange-600)" : "var(--ink)";
  return (
    <div className="card" style={{ padding: "0.8rem 0.9rem", minWidth: 0 }}>
      <div style={{ fontSize: "0.74rem", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 800, color, lineHeight: 1.2, wordBreak: "break-word" }}>{value}</div>
      {note && <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function Loading() {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "0.7rem 0.7rem", fontWeight: 700, fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.65rem 0.7rem", verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</td>;
}
