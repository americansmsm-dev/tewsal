"use client";

/**
 * لوحة العمليات — الشاشة الرئيسية.
 * حماية: بتفحص /auth/me؛ مفيش جلسة → تحويل لـ /login.
 * بتعرض جدول الشحنات + إنشاء + تنفيذ الإجراءات.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "./components/AppHeader";
import { AppNav } from "./components/AppNav";
import { useCurrentUser } from "./lib/useCurrentUser";
import { useDebounce } from "./lib/useDebounce";
import { CreateShipmentModal } from "./components/CreateShipmentModal";
import { TransitionModal } from "./components/TransitionModal";
import { ShipmentDetailsModal } from "./components/ShipmentDetailsModal";
import { BulkPickupModal } from "./components/BulkPickupModal";
import {
  apiCall,
  STATUS_LABELS_AR,
  statusTone,
  toneStyle,
  toArabicDigits,
  allowedTransitions,
  type ShipmentStatus,
  type Role,
} from "./lib/client";

interface ShipmentRow {
  id: string;
  awb: string;
  status: ShipmentStatus;
  recipient_name: string;
  recipient_phone: string;
  cod_amount_p: string;
  price_p: string;
  governorate: string;
  created_at: string;
  current_courier_id?: string | null;
  merchant_name?: string;
  courier_name?: string;
  picked_up_at?: string | null;
  delivered_at?: string | null;
}

/** تاريخ قصير بالعربي (يوم/شهر + وقت) */
function shortDate(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_FILTERS: (ShipmentStatus | "")[] = [
  "",
  "draft",
  "awaiting_pickup",
  "at_hub",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "returned_to_merchant",
];

function egp(piastres: string): string {
  const p = BigInt(piastres || "0");
  const whole = p / 100n;
  const frac = (p % 100n).toString().padStart(2, "0");
  return `${toArabicDigits(whole.toString())}.${toArabicDigits(frac)}`;
}

export default function Dashboard() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ShipmentStatus | "">("");
  const [q, setQ] = useState("");
  const dq = useDebounce(q, 350); // البحث بيتأجّل عشان مايعملش طلب مع كل حرف
  const [showCreate, setShowCreate] = useState(false);
  const [active, setActive] = useState<ShipmentRow | null>(null);
  const [details, setDetails] = useState<ShipmentRow | null>(null);
  // فلتر التاجر + الاستلام الجماعي
  const [merchantId, setMerchantId] = useState("");
  const [merchantList, setMerchantList] = useState<{ id: string; name_ar: string; code: string }[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (dq) params.set("q", dq);
    if (merchantId) params.set("merchantId", merchantId);
    const r = await apiCall<{ shipments: ShipmentRow[] }>(
      "GET",
      `/api/v1/shipments?${params.toString()}`
    );
    if (r.ok) setRows(r.data?.shipments ?? []);
    setLoading(false);
  }, [filter, dq, merchantId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // قائمة التجار للفلتر (للإدارة والعمليات بس)
  useEffect(() => {
    if (!user || !["super_admin", "branch_manager", "ops"].includes(user.role)) return;
    apiCall<{ merchants: { id: string; name_ar: string; code: string }[] }>("GET", "/api/v1/merchants?limit=200")
      .then((r) => { if (r.ok && r.data) setMerchantList(r.data.merchants); });
  }, [user]);

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>
        جاري التحميل...
      </div>
    );
  }

  const role = user.role as Role;
  const canCreate = ["super_admin", "branch_manager", "ops", "merchant"].includes(role);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={role} />

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "1.25rem" }}>
        {/* شريط الأدوات */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.15rem", marginInlineEnd: "auto" }}>
            الشحنات {!loading && <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 600 }}>({rows.length})</span>}
          </h2>
          <div style={{ position: "relative", maxWidth: 300, flex: "1 1 220px" }}>
            <input
              className="input"
              placeholder="بحث بالبوليصة أو الاسم أو التليفون..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              style={{ width: "100%", paddingInlineEnd: q ? 30 : undefined }}
            />
            {q && (
              <button onClick={() => setQ("")} aria-label="مسح البحث"
                style={{ position: "absolute", insetInlineEnd: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: 0, cursor: "pointer", color: "var(--muted)", fontSize: "1rem" }}>✕</button>
            )}
          </div>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + شحنة جديدة
            </button>
          )}
        </div>

        {/* فلتر التاجر + الاستلام الجماعي */}
        {["super_admin", "branch_manager", "ops"].includes(user.role) && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: "0.8rem" }}>
            <select className="input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}
              style={{ maxWidth: 280, flex: "1 1 200px" }}>
              <option value="">كل التجار</option>
              {merchantList.map((m) => <option key={m.id} value={m.id}>{m.name_ar} ({m.code})</option>)}
            </select>
            <button className="btn btn-primary" onClick={() => setShowBulk(true)}>🚚 استلام جماعي</button>
            {merchantId && filter === "awaiting_pickup" && rows.length > 0 && (
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                عند التاجر ده {toArabicDigits(rows.length)} أوردر مستني — جمّعهم على مندوب واحد بضغطة.
              </span>
            )}
          </div>
        )}
        {bulkMsg && (
          <div onClick={() => setBulkMsg(null)} style={{ marginBottom: "0.9rem", padding: "0.7rem 0.9rem", borderRadius: 12, background: "#16a34a18", border: "1px solid #16a34a33", color: "var(--color-success)", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
            ✅ {bulkMsg}
          </div>
        )}

        {/* فلاتر الحالة */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "1rem" }}>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s || "all"}
              onClick={() => setFilter(s)}
              className="badge"
              style={{
                cursor: "pointer",
                background: filter === s ? "var(--color-orange-500)" : "var(--surface)",
                color: filter === s ? "#1a1200" : "var(--text)",
                fontWeight: 700,
              }}
            >
              {s ? STATUS_LABELS_AR[s] : "الكل"}
            </button>
          ))}
        </div>

        {/* الجدول */}
        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>البوليصة</Th>
                <Th>البيدج</Th>
                <Th>المستلم</Th>
                <Th>المحافظة</Th>
                <Th>التحصيل</Th>
                <Th>الاستلام / التسليم</Th>
                <Th>الحالة</Th>
                <Th>إجراء</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                    جاري التحميل...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                    مفيش شحنات {filter ? "في الحالة دي" : "لسه"} — ابدأ بإنشاء شحنة جديدة
                  </td>
                </tr>
              ) : (
                rows.map((s) => {
                  const tone = toneStyle(statusTone(s.status));
                  const actions = allowedTransitions(s.status, role);
                  return (
                    <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <Td>
                        <span dir="ltr" style={{ fontWeight: 700, letterSpacing: "0.03em" }}>
                          {s.awb}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 700 }}>{s.merchant_name ?? "—"}</div>
                        {s.courier_name ? (
                          <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>مندوب: {s.courier_name}</div>
                        ) : null}
                      </Td>
                      <Td>
                        <div>{s.recipient_name}</div>
                        <div dir="ltr" style={{ color: "var(--muted)", fontSize: "0.78rem", textAlign: "right" }}>
                          {s.recipient_phone}
                        </div>
                      </Td>
                      <Td>{s.governorate}</Td>
                      <Td>
                        {BigInt(s.cod_amount_p || "0") > 0n ? (
                          <span style={{ fontWeight: 700 }}>{egp(s.cod_amount_p)} ج</span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </Td>
                      <Td>
                        <div style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                          <div style={{ color: shortDate(s.picked_up_at) ? "var(--ink)" : "var(--muted)" }}>
                            📥 {shortDate(s.picked_up_at) ?? "—"}
                          </div>
                          <div style={{ color: shortDate(s.delivered_at) ? "var(--color-success)" : "var(--muted)" }}>
                            ✅ {shortDate(s.delivered_at) ?? "—"}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className="badge" style={tone}>
                          {STATUS_LABELS_AR[s.status]}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {actions.length > 0 ? (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
                              onClick={() => setActive(s)}
                            >
                              تنفيذ إجراء
                            </button>
                          ) : (
                            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>—</span>
                          )}
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                            title="تفاصيل (رسوم وصور إثبات)"
                            onClick={() => setDetails(s)}
                          >
                            📋
                          </button>
                          <Link
                            href={`/shipments/${s.id}/label`}
                            target="_blank"
                            className="btn btn-ghost"
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                            title="طباعة البوليصة"
                          >
                            🖨️
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.75rem", textAlign: "center" }}>
          {toArabicDigits(rows.length)} شحنة معروضة
        </p>
      </main>

      {showBulk && (
        <BulkPickupModal
          initialMerchantId={merchantId || null}
          onClose={() => setShowBulk(false)}
          onDone={(m) => { setShowBulk(false); setBulkMsg(m); load(); }}
        />
      )}

      {showCreate && (
        <CreateShipmentModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
      {active && (
        <TransitionModal
          shipmentId={active.id}
          awb={active.awb}
          currentStatus={active.status}
          currentCourierId={active.current_courier_id ?? null}
          role={role}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            load();
          }}
        />
      )}
      {details && (
        <ShipmentDetailsModal
          shipmentId={details.id}
          awb={details.awb}
          status={details.status}
          canEdit={["super_admin", "branch_manager", "ops", "accountant"].includes(role)}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.78rem", color: "var(--muted)" }}>
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.7rem 0.85rem", verticalAlign: "middle" }}>{children}</td>;
}
