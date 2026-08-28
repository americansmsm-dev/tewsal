"use client";

/**
 * كشف حساب التاجر — الخانتين + حركات المستحقات + تشغيل تسوية.
 * ⚠️ الرقم «المؤكد» عمره ما يقل — ده جوهر الشفافية.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { AppNav } from "../../components/AppNav";
import { useCurrentUser } from "../../lib/useCurrentUser";
import { apiCall } from "../../lib/client";
import { STATUS_LABELS_AR } from "@/server/domain/statusMachine";

interface Line {
  awb: string;
  status: string;
  kind: string;
  net: string;
  recordedAt: string;
  settled: boolean;
}
interface Statement {
  confirmed: string;
  inCollection: string;
  totalP: string;
  lines: Line[];
}

const KIND_LABEL: Record<string, string> = {
  delivery: "تسليم",
  partial_delivery: "تسليم جزئي",
  return: "مرتجع",
  cancellation: "إلغاء",
};

export default function MerchantStatementPage() {
  const user = useCurrentUser();
  const params = useParams<{ id: string }>();
  const merchantId = params.id;
  const [st, setSt] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCall<Statement>("GET", `/api/v1/merchants/${merchantId}/statement`);
    if (r.ok) setSt(r.data);
    setLoading(false);
  }, [merchantId]);

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

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          <Link href="/merchants" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            → رجوع للتجار
          </Link>
          <h2 style={{ margin: "0.3rem 0 0", fontSize: "1.15rem" }}>كشف حساب التاجر</h2>
        </div>

        {/* الخانتين */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1.25rem" }}>
          <BalanceCard
            title="✅ مؤكد وجاهز للتحويل"
            hint="الكاش وصل الشركة فعلًا — الرقم ده مضمون"
            value={st?.confirmed ?? "—"}
            tone="success"
          />
          <BalanceCard
            title="⏳ تحت التحصيل"
            hint="تم التسليم بس الكاش لسه مع المندوب"
            value={st?.inCollection ?? "—"}
            tone="warn"
          />
        </div>

        {canSettle && (
          <div style={{ marginBottom: "1rem" }}>
            <button className="btn btn-primary" onClick={runSettlement} disabled={busy}>
              {busy ? "جاري التسوية..." : "تشغيل تسوية للمؤكد"}
            </button>
            {msg && (
              <span
                style={{
                  marginInlineStart: 12,
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: msg.kind === "ok" ? "var(--color-success)" : "var(--color-danger)",
                }}
              >
                {msg.text}
              </span>
            )}
          </div>
        )}

        {/* الحركات */}
        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>البوليصة</Th>
                <Th>النوع</Th>
                <Th>الحالة</Th>
                <Th>صافي المستحق</Th>
                <Th>التسوية</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                    جاري التحميل...
                  </td>
                </tr>
              ) : !st || st.lines.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                    مفيش حركات مالية على التاجر ده لسه
                  </td>
                </tr>
              ) : (
                st.lines.map((l, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>
                      <span dir="ltr" style={{ fontWeight: 700 }}>
                        {l.awb}
                      </span>
                    </Td>
                    <Td>{KIND_LABEL[l.kind] ?? l.kind}</Td>
                    <Td>
                      <span style={{ color: "var(--muted)" }}>{STATUS_LABELS_AR[l.status as never] ?? l.status}</span>
                    </Td>
                    <Td>
                      <span style={{ fontWeight: 700 }}>{l.net}</span>
                    </Td>
                    <Td>
                      {l.settled ? (
                        <span className="badge" style={{ color: "var(--color-success)" }}>
                          محوّلة
                        </span>
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

function BalanceCard({
  title,
  hint,
  value,
  tone,
}: {
  title: string;
  hint: string;
  value: string;
  tone: "success" | "warn";
}) {
  const color = tone === "success" ? "var(--color-success)" : "var(--color-warning)";
  return (
    <div className="card" style={{ padding: "1.1rem 1.25rem", borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: "1.7rem", fontWeight: 800, color, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 6 }}>{hint}</div>
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
