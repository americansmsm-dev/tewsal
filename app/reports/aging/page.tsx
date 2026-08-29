"use client";

/**
 * تقارير الأعمار — فلوس عندك ولسه ماوصلتش، مقسّمة بالعمر.
 * ١) كاش المناديب المعلّق  ٢) مستحقات التجار تحت التحصيل
 * الأعمدة الأقدم بتتلوّن تحذير/خطر عشان تبان بالبصر.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../../components/AppHeader";
import { AppNav } from "../../components/AppNav";
import { useCurrentUser } from "../../lib/useCurrentUser";
import { apiCall } from "../../lib/client";

interface AgingRow {
  id: string;
  name: string;
  buckets: string[];
  bucketsP: string[];
  total: string;
  totalP: string;
  oldestDays: number;
}
interface AgingTable {
  rows: AgingRow[];
  totals: string[];
  grandTotal: string;
  grandTotalP: string;
}
interface AgingData {
  buckets: string[];
  courierCash: AgingTable;
  merchantReceivables: AgingTable;
}

/** لون العمود حسب رتبة الشريحة: الأقدم أخطر */
const BUCKET_TONE = ["var(--muted)", "var(--text)", "var(--text)", "var(--color-warning)", "var(--color-danger)"];

export default function AgingReportsPage() {
  const user = useCurrentUser();
  const [data, setData] = useState<AgingData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await apiCall<AgingData>("GET", "/api/v1/reports/aging");
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
      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem" }}>تقارير الأعمار</h2>
        <p style={{ margin: "0 0 1.25rem", color: "var(--muted)", fontSize: "0.85rem" }}>
          فلوس محصّلة ولسه ماوصلتش الخزنة — مقسّمة بعمرها. كل ما زاد العمر زاد الخطر.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: "1.75rem" }}>
          <Stat label="كاش معلّق مع المناديب" value={data?.courierCash.grandTotal} tone="warn" />
          <Stat label="مستحقات تحت التحصيل" value={data?.merchantReceivables.grandTotal} tone="muted" />
        </div>

        <AgingSection
          title="أعمار كاش المناديب"
          hint="كل مندوب والكاش اللي ماسكه من غير ما يسلّم عهدته — مجموع الشرائح = رصيد عهدته."
          firstCol="المندوب"
          buckets={data?.buckets}
          table={data?.courierCash}
          loading={loading}
        />

        <div style={{ height: "1.5rem" }} />

        <AgingSection
          title="أعمار مستحقات التجار (تحت التحصيل)"
          hint="مستحقات اتسلّمت بس كاشها لسه مع المندوب — مبتدخلش «المؤكد» لحد ما العهدة تتسلّم."
          firstCol="التاجر"
          buckets={data?.buckets}
          table={data?.merchantReceivables}
          loading={loading}
        />
      </main>
    </div>
  );
}

function AgingSection({
  title, hint, firstCol, buckets, table, loading,
}: {
  title: string; hint: string; firstCol: string;
  buckets: string[] | undefined; table: AgingTable | undefined; loading: boolean;
}) {
  const cols = buckets ?? ["اليوم", "١–٣ أيام", "٤–٧ أيام", "٨–١٤ يوم", "أكبر من أسبوعين"];
  return (
    <section>
      <h3 style={{ fontSize: "1rem", margin: "0 0 0.15rem" }}>{title}</h3>
      <p style={{ margin: "0 0 0.6rem", color: "var(--muted)", fontSize: "0.8rem" }}>{hint}</p>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 640 }}>
          <thead>
            <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
              <Th>{firstCol}</Th>
              {cols.map((c, i) => (
                <Th key={c} align="left"><span style={{ color: BUCKET_TONE[i] }}>{c}</span></Th>
              ))}
              <Th align="left">الإجمالي</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length + 2} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
            ) : !table || table.rows.length === 0 ? (
              <tr><td colSpan={cols.length + 2} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش فلوس معلّقة دلوقتي 🎉</td></tr>
            ) : (
              table.rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td>
                    <span style={{ fontWeight: 700 }}>{r.name}</span>
                    {r.oldestDays >= 8 && (
                      <span style={{ marginInlineStart: 6, fontSize: "0.7rem", color: "var(--color-danger)", fontWeight: 700 }}>
                        ⚠ {r.oldestDays} يوم
                      </span>
                    )}
                  </Td>
                  {r.buckets.map((b, i) => (
                    <Td key={i} align="left">
                      <Amount value={b} raw={r.bucketsP[i]!} tone={BUCKET_TONE[i]!} />
                    </Td>
                  ))}
                  <Td align="left"><span style={{ fontWeight: 800 }}>{r.total}</span></Td>
                </tr>
              ))
            )}
          </tbody>
          {table && table.rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-soft)" }}>
                <Td><span style={{ fontWeight: 800 }}>الإجمالي</span></Td>
                {table.totals.map((t, i) => (
                  <Td key={i} align="left"><span style={{ fontWeight: 700, color: BUCKET_TONE[i] }}>{t}</span></Td>
                ))}
                <Td align="left"><span style={{ fontWeight: 900 }}>{table.grandTotal}</span></Td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

/** مبلغ — رمادي باهت لو صفر، وباللون لو فيه قيمة */
function Amount({ value, raw, tone }: { value: string; raw: string; tone: string }) {
  const zero = raw === "0";
  return (
    <span style={{ color: zero ? "var(--muted)" : tone, opacity: zero ? 0.45 : 1, fontWeight: zero ? 400 : 700, fontVariantNumeric: "tabular-nums" }}>
      {value}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | undefined; tone?: "warn" | "muted" }) {
  const color = tone === "warn" ? "var(--color-warning)" : tone === "muted" ? "var(--muted)" : "var(--text)";
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
function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.76rem", color: "var(--muted)", textAlign: align ?? "right", whiteSpace: "nowrap" }}>{children}</th>;
}
function Td({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td style={{ padding: "0.65rem 0.85rem", verticalAlign: "middle", textAlign: align ?? "right", whiteSpace: "nowrap" }}>{children}</td>;
}
