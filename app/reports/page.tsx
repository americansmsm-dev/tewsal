"use client";

/**
 * مركز التقارير — تبويبات: المحاسبة (ميزان/أرباح/إيرادات) · اليومية
 * · سكوركارد المناديب · ربحية التجار · الأعمار. كلها قراءة فقط
 * مشتقّة من الدفتر — مصدر واحد للحقيقة.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

function egp(p: string | null | undefined): string {
  const v = BigInt(p || "0");
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "−" : ""}${(a / 100n).toLocaleString("en-US")}.${(a % 100n).toString().padStart(2, "0")} ج`;
}

const TYPE_AR: Record<string, string> = { asset: "أصول", liability: "التزامات", revenue: "إيرادات", expense: "مصروفات", equity: "حقوق ملكية" };
const TIER_AR: Record<string, string> = { t1: "الأولى", t2: "الثانية", t3: "الثالثة" };

type Tab = "accounting" | "journal" | "couriers" | "merchants" | "ops" | "aging";

export default function ReportsPage() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<Tab>("accounting");

  if (!user) return <Loading />;
  const isFinance = ["super_admin", "branch_manager", "accountant"].includes(user.role);
  const ALL_TABS: { key: Tab; label: string; finance?: boolean }[] = [
    { key: "accounting", label: "المحاسبة", finance: true },
    { key: "journal", label: "دفتر اليومية", finance: true },
    { key: "couriers", label: "المناديب" },
    { key: "merchants", label: "التجار" },
    { key: "ops", label: "تشغيلي" },
    { key: "aging", label: "الأعمار", finance: true },
  ];
  const tabs = ALL_TABS.filter((t) => !t.finance || isFinance);

  // لو التبويب الافتراضي مش متاح للدور، نبدأ من أول متاح
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]!.key;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem" }}>التقارير</h2>
        <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.83rem", lineHeight: 1.7 }}>
          كل الأرقام هنا <b>مشتقّة من الدفتر المحاسبي</b> مباشرة — يعني مفيش رقم متكتب بالإيد، وكله يتطابق مع فلوسك الفعلية.
          الأرقام <b>من بداية التشغيل لحد دلوقتي</b>. كل قسم تحته سطر بيشرح الرقم معناه إيه.
        </p>

        <div style={{ display: "flex", gap: 4, marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={activeTab === t.key ? "btn btn-primary" : "btn btn-ghost"}
              style={{ padding: "0.45rem 1.1rem", fontSize: "0.86rem" }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "accounting" && <AccountingTab />}
        {activeTab === "journal" && <JournalTab />}
        {activeTab === "couriers" && <CouriersTab />}
        {activeTab === "merchants" && <MerchantsTab />}
        {activeTab === "ops" && <OpsTab />}
        {activeTab === "aging" && (
          <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
            <p style={{ color: "var(--muted)", marginBottom: 12 }}>تقارير أعمار الكاش والمستحقات في صفحة مخصّصة.</p>
            <Link href="/reports/aging" className="btn btn-primary">افتح تقارير الأعمار</Link>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── المحاسبة ───
interface Pnl { revenue: { code: string; nameAr: string; amountP: string }[]; expense: { code: string; nameAr: string; amountP: string }[]; totalRevenueP: string; totalExpenseP: string; netProfitP: string }
interface Trial { rows: { code: string; nameAr: string; type: string; debitP: string; creditP: string; balanceP: string }[]; totalDebitP: string; totalCreditP: string; balanced: boolean }
interface Rev { rows: { code: string; nameAr: string; amountP: string }[]; totalP: string }

function AccountingTab() {
  const [data, setData] = useState<{ trial: Trial; pnl: Pnl; revenue: Rev } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiCall<{ trial: Trial; pnl: Pnl; revenue: Rev }>("GET", "/api/v1/reports/accounting").then((r) => {
      if (r.ok && r.data) setData(r.data);
      setLoading(false);
    });
  }, []);
  if (loading) return <Muted>جاري التحميل...</Muted>;
  if (!data) return <Muted>مفيش بيانات</Muted>;

  const net = BigInt(data.pnl.netProfitP);
  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {/* الملخص — أهم ٣ أرقام قبل أي جدول */}
      <StatRow>
        <Stat label="إجمالي الإيراد" value={egp(data.pnl.totalRevenueP)} tone="accent" note="كل اللي دخلك من الشحن والتحصيل والرسوم" />
        <Stat label="إجمالي المصروف" value={egp(data.pnl.totalExpenseP)} note="عمولات وتعويضات وفروقات ومصاريف" />
        <Stat label={net >= 0n ? "صافي الربح" : "صافي الخسارة"} value={egp(data.pnl.netProfitP)} tone={net >= 0n ? "good" : "bad"} note="الإيراد ناقص المصروف" />
      </StatRow>

      {/* الأرباح والخسائر */}
      <Section title="الأرباح والخسائر" hint="فلوسك دخلت منين وخرجت فين، والفرق بينهم هو مكسبك الصافي. الأرقام من بداية التشغيل لحد دلوقتي.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: "1rem", minWidth: 0 }}>
          <div>
            <SubHead>الإيرادات</SubHead>
            {data.pnl.revenue.map((l) => <KV key={l.code} k={l.nameAr} v={egp(l.amountP)} />)}
            <KV k="إجمالي الإيراد" v={egp(data.pnl.totalRevenueP)} strong />
          </div>
          <div>
            <SubHead>المصروفات</SubHead>
            {data.pnl.expense.length === 0 ? <Muted small>مفيش مصروفات</Muted> : data.pnl.expense.map((l) => <KV key={l.code} k={l.nameAr} v={egp(l.amountP)} />)}
            <KV k="إجمالي المصروف" v={egp(data.pnl.totalExpenseP)} strong />
          </div>
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "2px solid var(--border)", display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1.05rem" }}>
          <span>صافي الربح</span>
          <span style={{ color: BigInt(data.pnl.netProfitP) >= 0n ? "var(--color-success)" : "var(--color-danger)" }}>{egp(data.pnl.netProfitP)}</span>
        </div>
      </Section>

      {/* الإيرادات حسب النوع */}
      <Section title="الإيرادات حسب النوع" hint="إيرادك جاي منين بالظبط — شحن، تحصيل، مرتجعات، أو رسوم تانية.">
        {data.revenue.rows.map((l) => <KV key={l.code} k={l.nameAr} v={egp(l.amountP)} />)}
        <KV k="الإجمالي" v={egp(data.revenue.totalP)} strong />
      </Section>

      {/* ميزان المراجعة */}
      <Section title="ميزان المراجعة" hint="كشف بكل حسابات الشركة. المهم فيه إن «مدين» تساوي «دائن» بالظبط — وده اللي بيضمن إن مفيش جنيه ضايع أو متسجّل غلط.">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>الحساب</Th><Th>النوع</Th><Th>مدين</Th><Th>دائن</Th>
              </tr>
            </thead>
            <tbody>
              {data.trial.rows.map((r) => (
                <tr key={r.code} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td>{r.nameAr}</Td>
                  <Td><span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{TYPE_AR[r.type] ?? r.type}</span></Td>
                  <Td>{BigInt(r.debitP) > 0n ? egp(r.debitP) : "—"}</Td>
                  <Td>{BigInt(r.creditP) > 0n ? egp(r.creditP) : "—"}</Td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 800 }}>
                <Td>الإجمالي</Td><Td></Td>
                <Td>{egp(data.trial.totalDebitP)}</Td>
                <Td>{egp(data.trial.totalCreditP)}</Td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontWeight: 700, color: data.trial.balanced ? "var(--color-success)" : "var(--color-danger)" }}>
          {data.trial.balanced ? "✅ الميزان متوازن — مدين = دائن" : "⚠️ الميزان مش متوازن — فيه خلل، راجع فورًا"}
        </div>
      </Section>
    </div>
  );
}

// ─── دفتر اليومية ───
interface JEntry { entryNo: string; entryDate: string; descriptionAr: string; kind: string; sourceType: string; totalP: string; isReversal: boolean }
const KIND_AR: Record<string, string> = {
  delivery: "تسليم", return: "إرجاع", cancellation: "إلغاء", handover: "تسليم عهدة", bank_deposit: "إيداع بنكي",
  payout: "تحويل مستحقات", compensation: "تعويض", commission: "عمولة", pickup_fee: "رسم استلام", disposal: "إتلاف", deduction_waive: "إعفاء خصم",
};

function JournalTab() {
  const [rows, setRows] = useState<JEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const r = await apiCall<{ journal: JEntry[] }>("GET", "/api/v1/reports/journal?limit=80");
    if (r.ok && r.data) setRows(r.data.journal);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loading) return <Muted>جاري التحميل...</Muted>;

  return (
    <Section title="دفتر اليومية" hint="كل عملية مالية حصلت في السيستم بالترتيب الزمني — تسليم، مرتجع، تحويل، عهدة. ده السجل الرسمي: مفيش حاجة بتتمسح منه، وأي تصحيح بيتسجّل كقيد جديد.">
    <div style={{ overflowX: "auto", margin: "0 -0.35rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 640 }}>
        <thead>
          <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
            <Th>#</Th><Th>البيان</Th><Th>النوع</Th><Th>الإجمالي</Th><Th>التاريخ</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>مفيش قيود</td></tr> :
           rows.map((e) => (
            <tr key={e.entryNo} style={{ borderTop: "1px solid var(--border)" }}>
              <Td><span style={{ fontFamily: "monospace", color: "var(--muted)" }}>{e.entryNo}</span></Td>
              <Td>{e.descriptionAr}{e.isReversal && <span style={{ color: "var(--color-danger)", fontSize: "0.72rem" }}> (عكسي)</span>}</Td>
              <Td><span className="badge" style={{ fontSize: "0.72rem" }}>{KIND_AR[e.kind] ?? e.kind}</span></Td>
              <Td><b>{egp(e.totalP)}</b></Td>
              <Td><span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{new Date(e.entryDate).toLocaleDateString("ar-EG")}</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </Section>
  );
}

// ─── المناديب ───
interface CScore { id: string; name: string; deliveredCount: number; returnedCount: number; firstAttemptRate: number; returnRate: number; cashHeldP: string; commissionsP: string; deductionsP: string; lastDeliveryAt: string | null }

function CouriersTab() {
  const [rows, setRows] = useState<CScore[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiCall<{ couriers: CScore[] }>("GET", "/api/v1/reports/couriers").then((r) => {
      if (r.ok && r.data) setRows(r.data.couriers);
      setLoading(false);
    });
  }, []);
  if (loading) return <Muted>جاري التحميل...</Muted>;

  const totalDelivered = rows.reduce((s, c) => s + c.deliveredCount, 0);
  const totalCash = rows.reduce((s, c) => s + BigInt(c.cashHeldP), 0n);
  const holding = rows.filter((c) => BigInt(c.cashHeldP) > 0n).length;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <StatRow>
        <Stat label="إجمالي التسليمات" value={String(totalDelivered)} tone="accent" note={`من ${rows.length} مندوب`} />
        <Stat label="كاش في عهدة المناديب" value={egp(totalCash.toString())} tone={totalCash > 0n ? "bad" : "good"} note={holding > 0 ? `${holding} مندوب ماسك كاش` : "كله اتسلّم للخزنة"} />
      </StatRow>

      <Section title="أداء المناديب" hint="كل مندوب بيسلّم كام، وبيرجّع كام، وماسك كاش قد إيه. «من أول مرة» = نسبة الأوردرات اللي سلّمها من أول محاولة — كل ما تزيد كل ما كان أحسن. الكاش الأصفر معناه لسه في جيبه ومحتاج يسلّمه.">
    <div style={{ overflowX: "auto", margin: "0 -0.35rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem", minWidth: 820 }}>
        <thead>
          <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
            <Th>المندوب</Th><Th>تسليم</Th><Th>من أول مرة</Th><Th>مرتجعات</Th><Th>كاش العهدة</Th><Th>عمولات</Th><Th>خصومات</Th><Th>آخر تسليم</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={8} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش مناديب لسه</td></tr> :
           rows.map((c) => (
            <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
              <Td><b>{c.name}</b></Td>
              <Td>{c.deliveredCount}</Td>
              <Td><Rate v={c.firstAttemptRate} good /></Td>
              <Td><span>{c.returnedCount}</span> <Rate v={c.returnRate} good={false} inline /></Td>
              <Td><b style={{ color: BigInt(c.cashHeldP) > 0n ? "var(--color-warning)" : "var(--muted)" }}>{egp(c.cashHeldP)}</b></Td>
              <Td>{egp(c.commissionsP)}</Td>
              <Td>{BigInt(c.deductionsP) > 0n ? <span style={{ color: "var(--color-danger)" }}>{egp(c.deductionsP)}</span> : "—"}</Td>
              <Td><span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{c.lastDeliveryAt ? new Date(c.lastDeliveryAt).toLocaleDateString("ar-EG") : "—"}</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      </Section>
    </div>
  );
}

// ─── التجار ───
interface MProfit { id: string; name: string; code: string; tier: string; shipmentsCount: number; deliveredCount: number; returnedCount: number; lostCount: number; deliveryRate: number; revenueP: string; avgRevenuePerDeliveredP: string }

function MerchantsTab() {
  const [rows, setRows] = useState<MProfit[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiCall<{ merchants: MProfit[] }>("GET", "/api/v1/reports/merchants").then((r) => {
      if (r.ok && r.data) setRows(r.data.merchants);
      setLoading(false);
    });
  }, []);
  if (loading) return <Muted>جاري التحميل...</Muted>;

  const totalRev = rows.reduce((s, m) => s + BigInt(m.revenueP), 0n);
  const totalShip = rows.reduce((s, m) => s + m.shipmentsCount, 0);
  const best = [...rows].sort((a, b) => (BigInt(b.revenueP) > BigInt(a.revenueP) ? 1 : -1))[0];

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <StatRow>
        <Stat label="إيرادك من التجار" value={egp(totalRev.toString())} tone="accent" note={`من ${totalShip} شحنة · ${rows.length} تاجر`} />
        {best && <Stat label="أعلى تاجر إيرادًا" value={best.name} tone="good" note={egp(best.revenueP)} />}
      </StatRow>

      <Section title="ربحية التجار" hint="كل تاجر بيجيبلك كام، وبيسلّم نسبة قد إيه. «نسبة التسليم» العالية معناها تاجر بضاعته بتوصل — والتاجر اللي نسبته واطية بيكلّفك مرتجعات. استخدم ده وإنت بتفاوض على الأسعار.">
    <div style={{ overflowX: "auto", margin: "0 -0.35rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem", minWidth: 820 }}>
        <thead>
          <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
            <Th>التاجر</Th><Th>الشريحة</Th><Th>شحنات</Th><Th>تسليم</Th><Th>مرتجع</Th><Th>نسبة التسليم</Th><Th>الإيراد</Th><Th>متوسط/شحنة</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={8} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش تجار بشحنات لسه</td></tr> :
           rows.map((m) => (
            <tr key={m.id} style={{ borderTop: "1px solid var(--border)" }}>
              <Td><b>{m.name}</b> <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>{m.code}</span></Td>
              <Td><span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{TIER_AR[m.tier] ?? m.tier}</span></Td>
              <Td>{m.shipmentsCount}</Td>
              <Td>{m.deliveredCount}</Td>
              <Td>{m.returnedCount}{m.lostCount > 0 && <span style={{ color: "var(--color-danger)", fontSize: "0.72rem" }}> +{m.lostCount} فقد</span>}</Td>
              <Td><Rate v={m.deliveryRate} good /></Td>
              <Td><b style={{ color: "var(--color-success)" }}>{egp(m.revenueP)}</b></Td>
              <Td>{egp(m.avgRevenuePerDeliveredP)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      </Section>
    </div>
  );
}

// ─── تشغيلي ───
interface Turnover { id: string; name: string; inCustody: number; avgAgeDays: number; oldestDays: number }
interface Dormant { id: string; name: string; code: string; totalShipments: number; lastShipmentAt: string | null; daysSinceLast: number | null }
interface Treasury { branches: { id: string; code: string; name: string; cashOnHandP: string; handoversInP: string; depositsOutP: string }[]; fleetExpenseP: string }
interface MPickup { month: string; pickupsCount: number; ordersCount: number; serviceFeesP: string }
interface OpsData { turnover: Turnover[]; dormant: { rows: Dormant[]; dormantAfterDays: number }; treasury: Treasury; pickups: MPickup[] }

function OpsTab() {
  const [data, setData] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiCall<OpsData>("GET", "/api/v1/reports/ops").then((r) => {
      if (r.ok && r.data) setData(r.data);
      setLoading(false);
    });
  }, []);
  if (loading) return <Muted>جاري التحميل...</Muted>;
  if (!data) return <Muted>مفيش بيانات</Muted>;
  const threshold = data.dormant.dormantAfterDays;

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {/* دوران شحنات المناديب */}
      <Section title="دوران شحنات المناديب — الشحنات في العهدة" hint="شحنات قاعدة مع المناديب من إمتى. كل ما العمر يزيد، كل ما الأوردر اتأخر والعميل زهق — تابع اللي فوق يومين.">
        {data.turnover.length === 0 ? <Muted small>مفيش شحنات في العهدة دلوقتي 🎉</Muted> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
              <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>المندوب</Th><Th>في العهدة</Th><Th>متوسط العمر</Th><Th>أقدم شحنة</Th></tr></thead>
              <tbody>
                {data.turnover.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td><b>{c.name}</b></Td>
                    <Td>{c.inCustody}</Td>
                    <Td>{c.avgAgeDays} يوم</Td>
                    <Td><span style={{ fontWeight: 700, color: c.oldestDays >= 3 ? "var(--color-danger)" : c.oldestDays >= 2 ? "var(--color-warning)" : "var(--muted)" }}>{c.oldestDays} يوم</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* الراسلين المتوقفين */}
      <Section title={`الراسلين المتوقفين (أكتر من ${threshold} يوم سكوت)`}>
        {data.dormant.rows.length === 0 ? <Muted small>مفيش تجار بشحنات</Muted> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
              <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>التاجر</Th><Th>إجمالي الشحنات</Th><Th>آخر شحنة</Th><Th>مدة السكوت</Th></tr></thead>
              <tbody>
                {data.dormant.rows.map((m) => {
                  const dormant = (m.daysSinceLast ?? 0) >= threshold;
                  return (
                    <tr key={m.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <Td><b>{m.name}</b> <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>{m.code}</span></Td>
                      <Td>{m.totalShipments}</Td>
                      <Td><span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{m.lastShipmentAt ? new Date(m.lastShipmentAt).toLocaleDateString("ar-EG") : "—"}</span></Td>
                      <Td><span style={{ fontWeight: 700, color: dormant ? "var(--color-danger)" : "var(--muted)" }}>{m.daysSinceLast ?? "—"} يوم{dormant ? " ⚠️" : ""}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* خزائن الفروع */}
      <Section title="خزائن الفروع" hint="الكاش الموجود في كل فرع دلوقتي، واللي دخل من المناديب، واللي اتودع في البنك.">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>الفرع</Th><Th>الكاش في الخزنة</Th><Th>وارد من المناديب</Th><Th>مودَع في البنك</Th></tr></thead>
            <tbody>
              {data.treasury.branches.map((b) => (
                <tr key={b.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td><b>{b.name}</b></Td>
                  <Td><b style={{ color: BigInt(b.cashOnHandP) > 0n ? "var(--color-warning)" : "var(--muted)" }}>{egp(b.cashOnHandP)}</b></Td>
                  <Td>{egp(b.handoversInP)}</Td>
                  <Td>{egp(b.depositsOutP)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: "0.8rem", color: "var(--muted)" }}>
          مصاريف الأسطول (على مستوى الشركة): <b style={{ color: "var(--text)" }}>{egp(data.treasury.fleetExpenseP)}</b>
          {BigInt(data.treasury.fleetExpenseP) === 0n && " — لسه مش مربوطة (بتتفعّل مع وحدة الأسطول)"}
        </div>
      </Section>

      {/* البيك أب الشهري */}
      <Section title="البيك أب الشهري" hint="عدد مرات الاستلام من التجار كل شهر والأوردرات اللي اتجمعت ورسوم الخدمة اللي اتحسبت.">
        {data.pickups.length === 0 ? <Muted small>مفيش استلامات مكتملة لسه</Muted> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
              <thead><tr style={{ background: "var(--bg-soft)", textAlign: "right" }}><Th>الشهر</Th><Th>عدد الاستلامات</Th><Th>الأوردرات</Th><Th>رسوم الخدمة</Th></tr></thead>
              <tbody>
                {data.pickups.map((p) => (
                  <tr key={p.month} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td><span style={{ fontFamily: "monospace" }}>{p.month}</span></Td>
                    <Td>{p.pickupsCount}</Td>
                    <Td>{p.ordersCount}</Td>
                    <Td>{egp(p.serviceFeesP)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── عناصر مشتركة ───
function Rate({ v, good, inline }: { v: number; good: boolean; inline?: boolean }) {
  const tone = good ? (v >= 80 ? "var(--color-success)" : v >= 50 ? "var(--color-warning)" : "var(--color-danger)")
                    : (v <= 10 ? "var(--color-success)" : v <= 25 ? "var(--color-warning)" : "var(--color-danger)");
  return <span style={{ fontWeight: 700, color: tone, fontSize: inline ? "0.72rem" : undefined }}>{inline ? `(${v}%)` : `${v}%`}</span>;
}
/** عنوان القسم + سطر يشرح الرقم ده معناه إيه بالبلدي */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
      <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
      {hint && <p style={{ margin: "0.25rem 0 0.9rem", color: "var(--muted)", fontSize: "0.8rem", lineHeight: 1.6 }}>{hint}</p>}
      {!hint && <div style={{ height: "0.9rem" }} />}
      {children}
    </div>
  );
}
function SubHead({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--muted)", marginBottom: 6 }}>{children}</div>;
}
function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", fontWeight: strong ? 800 : 400, borderTop: strong ? "1px solid var(--border)" : undefined, marginTop: strong ? 4 : 0 }}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}
/** كارت رقم كبير — الأرقام المهمة تبان من غير ما تدوّر في جدول */
function Stat({ label, value, tone, note }: { label: string; value: string; tone?: "good" | "bad" | "accent"; note?: string }) {
  const color = tone === "good" ? "var(--color-success)" : tone === "bad" ? "var(--color-danger)" : tone === "accent" ? "var(--color-orange-600)" : "var(--ink)";
  return (
    <div className="card" style={{ padding: "0.9rem 1rem", minWidth: 0 }}>
      <div style={{ fontSize: "0.76rem", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800, color, lineHeight: 1.2, wordBreak: "break-word" }}>{value}</div>
      {note && <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 3 }}>{note}</div>}
    </div>
  );
}
function StatRow({ children }: { children: React.ReactNode }) {
  // ⚠️ min(150px,100%) مهمة: من غيرها الشبكة بترفض تصغّر تحت ١٥٠بكسل للعمود
  //    فبتطلع أعرض من الشاشة على الموبايل والجزء الزايد بيتقص.
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
      gap: "0.7rem", minWidth: 0, maxWidth: "100%",
    }}>{children}</div>
  );
}

function Muted({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <div style={{ color: "var(--muted)", padding: small ? "0.3rem 0" : "1.5rem", textAlign: small ? "right" : "center", fontSize: small ? "0.82rem" : undefined }}>{children}</div>;
}
function Loading() { return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>; }
function Th({ children }: { children: React.ReactNode }) { return <th style={{ padding: "0.65rem 0.8rem", fontWeight: 700, fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children }: { children?: React.ReactNode }) { return <td style={{ padding: "0.6rem 0.8rem", verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</td>; }
