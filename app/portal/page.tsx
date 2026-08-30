"use client";

/**
 * بوابة التاجر — التاجر يدخل بحسابه يشوف فلوسه وشحناته.
 * أول حاجة يشوفها: مؤكد / تحت التحصيل، وشحناته المتأخرة.
 * حماية: لازم يكون دوره تاجر ومربوط بسجل تاجر.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreateShipmentModal } from "../components/CreateShipmentModal";
import { WalletPanel } from "../components/WalletPanel";
import { apiCall, STATUS_LABELS_AR, statusTone, toneStyle, toArabicDigits, type ShipmentStatus } from "../lib/client";

interface Me {
  id: string;
  name: string;
  role: string;
  merchantId: string | null;
}
interface Statement {
  confirmed: string;
  inCollection: string;
}
interface ShipmentRow {
  id: string;
  awb: string;
  status: ShipmentStatus;
  recipient_name: string;
  recipient_phone: string;
  cod_amount_p: string;
  governorate: string;
}

function egp(p: string): string {
  const v = BigInt(p || "0");
  return `${toArabicDigits((v / 100n).toString())}.${toArabicDigits((v % 100n).toString().padStart(2, "0"))} ج`;
}

export default function PortalPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [st, setSt] = useState<Statement | null>(null);
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadData = useCallback(async (merchantId: string) => {
    const [s, list] = await Promise.all([
      apiCall<Statement>("GET", `/api/v1/merchants/${merchantId}/statement`),
      apiCall<{ shipments: ShipmentRow[] }>("GET", "/api/v1/shipments?limit=100"),
    ]);
    if (s.ok) setSt(s.data);
    if (list.ok) setRows(list.data?.shipments ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    apiCall<{ user: Me }>("GET", "/api/v1/auth/me").then((r) => {
      if (!r.ok) return router.replace("/login");
      const u = r.data!.user;
      if (u.role !== "merchant" || !u.merchantId) return router.replace("/");
      setMe(u);
      loadData(u.merchantId);
    });
  }, [router, loadData]);

  async function logout() {
    await apiCall("POST", "/api/v1/auth/logout");
    router.replace("/login");
  }

  if (!me) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)" }}>
      {/* هيدر التاجر */}
      <header style={{ background: "var(--color-navy-900)", color: "#fff", padding: "0.85rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "1.35rem", fontWeight: 800 }}>توص<span style={{ color: "var(--color-orange-500)" }}>ّل</span></span>
          <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>بوابة التاجر</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{me.name}</span>
          <button className="btn btn-ghost" onClick={logout} style={{ color: "#fff", borderColor: "#ffffff33", fontSize: "0.8rem" }}>خروج</button>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.25rem" }}>
        {/* الخانتين */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1.25rem" }}>
          <div className="card" style={{ padding: "1.1rem 1.25rem", borderTop: "3px solid var(--color-success)" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>✅ مؤكد وجاهز للتحويل</div>
            <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--color-success)" }}>{st?.confirmed ?? "—"}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4 }}>الكاش وصل الشركة — الرقم ده مضمون</div>
          </div>
          <div className="card" style={{ padding: "1.1rem 1.25rem", borderTop: "3px solid var(--color-warning)" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>⏳ تحت التحصيل</div>
            <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--color-warning)" }}>{st?.inCollection ?? "—"}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4 }}>تم التسليم بس الكاش لسه مع المندوب</div>
          </div>
        </div>

        {/* المحفظة — عرض فقط للتاجر (بيشوف رصيده عشان يشحن الأوردرات من غير تحصيل) */}
        {me.merchantId && <WalletPanel merchantId={me.merchantId} canDeposit={false} />}

        <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", marginInlineEnd: "auto" }}>شحناتي</h2>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ شحنة جديدة</button>
        </div>

        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>البوليصة</Th><Th>المستلم</Th><Th>المحافظة</Th><Th>التحصيل</Th><Th>الحالة</Th><Th>بوليصة</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش شحنات لسه — ابدأ بإنشاء شحنة</td></tr>
              ) : rows.map((s) => {
                const tone = toneStyle(statusTone(s.status));
                return (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td><span dir="ltr" style={{ fontWeight: 700 }}>{s.awb}</span></Td>
                    <Td><div>{s.recipient_name}</div><div dir="ltr" style={{ color: "var(--muted)", fontSize: "0.78rem", textAlign: "right" }}>{s.recipient_phone}</div></Td>
                    <Td>{s.governorate}</Td>
                    <Td>{BigInt(s.cod_amount_p || "0") > 0n ? <b>{egp(s.cod_amount_p)}</b> : <span style={{ color: "var(--muted)" }}>—</span>}</Td>
                    <Td><span className="badge" style={tone}>{STATUS_LABELS_AR[s.status]}</span></Td>
                    <Td><Link href={`/shipments/${s.id}/label`} target="_blank" className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>🖨️</Link></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {showCreate && me.merchantId && (
        <CreateShipmentModal
          lockedMerchantId={me.merchantId}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); if (me.merchantId) loadData(me.merchantId); }}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) { return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.78rem", color: "var(--muted)" }}>{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td style={{ padding: "0.7rem 0.85rem", verticalAlign: "middle" }}>{children}</td>; }
