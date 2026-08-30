"use client";

/**
 * تطبيق التاجر — موبايل أولًا بتبويبات سفلية:
 *  🏠 الرئيسية · 📦 شحناتي · 💰 حسابي · ↩️ المرتجعات · 👤 بياناتي
 * أول حاجة يشوفها: مؤكد / تحت التحصيل + محفظته + إحصائياته.
 * حماية: لازم يكون دوره تاجر ومربوط بسجل تاجر.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreateShipmentModal } from "../components/CreateShipmentModal";
import { WalletPanel } from "../components/WalletPanel";
import { InstallPrompt } from "../components/InstallPrompt";
import { apiCall, STATUS_LABELS_AR, statusTone, toneStyle, toArabicDigits, type ShipmentStatus } from "../lib/client";

interface Me { id: string; name: string; role: string; merchantId: string | null; }
interface Line { awb: string; status: string; kind: string; net: string; recordedAt: string; settled: boolean; }
interface Statement { confirmed: string; inCollection: string; lines: Line[]; }
interface ShipmentRow {
  id: string; awb: string; status: ShipmentStatus;
  recipient_name: string; recipient_phone: string; cod_amount_p: string; governorate: string;
}
type Tab = "home" | "shipments" | "account" | "returns" | "profile";

const RETURN_STATUSES = ["awaiting_return", "out_for_return", "returned_to_merchant"];
const DELIVERED_STATUSES = ["delivered", "partially_delivered"];
const KIND_LABEL: Record<string, string> = {
  delivery: "تسليم", partial_delivery: "تسليم جزئي", return: "مرتجع", cancellation: "إلغاء",
};

function egp(p: string): string {
  const v = BigInt(p || "0");
  return `${toArabicDigits((v / 100n).toLocaleString("en-US"))}.${toArabicDigits((v % 100n).toString().padStart(2, "0"))} ج`;
}

export default function PortalPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [st, setSt] = useState<Statement | null>(null);
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadData = useCallback(async (merchantId: string) => {
    const [s, list] = await Promise.all([
      apiCall<Statement>("GET", `/api/v1/merchants/${merchantId}/statement`),
      apiCall<{ shipments: ShipmentRow[] }>("GET", "/api/v1/shipments?limit=300"),
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

  const stats = useMemo(() => {
    const s = { total: rows.length, active: 0, delivered: 0, returns: 0 };
    for (const r of rows) {
      if (DELIVERED_STATUSES.includes(r.status)) s.delivered++;
      else if (RETURN_STATUSES.includes(r.status)) s.returns++;
      else if (!["cancelled", "lost", "damaged", "disposed"].includes(r.status)) s.active++;
    }
    return s;
  }, [rows]);

  const refresh = () => { if (me?.merchantId) loadData(me.merchantId); };

  if (!me) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", maxWidth: 640, margin: "0 auto", paddingBottom: 72 }}>
      <InstallPrompt />
      <header style={{ background: "var(--color-navy-900)", color: "#fff", padding: "0.85rem 1.1rem", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>توص<span style={{ color: "var(--color-orange-500)" }}>ّل</span></div>
          <div style={{ fontSize: "0.72rem", opacity: 0.6 }}>{TAB_LABELS[tab]}</div>
        </div>
        <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{me.name}</span>
      </header>

      <main style={{ padding: "1.1rem" }}>
        {tab === "home" && <HomeTab me={me} st={st} stats={stats} onCreate={() => setShowCreate(true)} goShip={() => setTab("shipments")} />}
        {tab === "shipments" && <ShipmentsTab rows={rows} loading={loading} onCreate={() => setShowCreate(true)} />}
        {tab === "account" && <AccountTab me={me} st={st} />}
        {tab === "returns" && <ReturnsTab rows={rows} />}
        {tab === "profile" && <ProfileTab me={me} rows={rows} onDone={refresh} logout={logout} />}
      </main>

      <nav style={{
        position: "fixed", insetInlineStart: 0, insetInlineEnd: 0, bottom: 0, zIndex: 20,
        maxWidth: 640, margin: "0 auto", background: "var(--surface)", borderTop: "1px solid var(--border)",
        display: "grid", gridTemplateColumns: "repeat(5,1fr)", padding: "0.35rem 0.25rem 0.5rem",
      }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((k) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: "transparent", border: 0, cursor: "pointer", padding: "0.35rem 0",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            color: tab === k ? "var(--color-orange-600)" : "var(--muted)", fontWeight: tab === k ? 800 : 600,
          }}>
            <span style={{ fontSize: "1.25rem", lineHeight: 1 }}>{TAB_ICONS[k]}</span>
            <span style={{ fontSize: "0.68rem" }}>{TAB_LABELS[k]}</span>
          </button>
        ))}
      </nav>

      {showCreate && me.merchantId && (
        <CreateShipmentModal
          lockedMerchantId={me.merchantId}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); refresh(); }}
        />
      )}
    </div>
  );
}

const TAB_LABELS: Record<Tab, string> = { home: "الرئيسية", shipments: "شحناتي", account: "حسابي", returns: "المرتجعات", profile: "بياناتي" };
const TAB_ICONS: Record<Tab, string> = { home: "🏠", shipments: "📦", account: "💰", returns: "↩️", profile: "👤" };

// ─────────────────────────── الرئيسية ───────────────────────────
function HomeTab({ me, st, stats, onCreate, goShip }: {
  me: Me; st: Statement | null; stats: { total: number; active: number; delivered: number; returns: number };
  onCreate: () => void; goShip: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>أهلًا {me.name} 👋</div>

      {/* الخانتين */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card" style={{ padding: "1rem 1.1rem", borderTop: "3px solid var(--color-success)" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>✅ مؤكد وجاهز للتحويل</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--color-success)" }}>{st?.confirmed ?? "—"}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>الكاش وصل الشركة — مضمون</div>
        </div>
        <div className="card" style={{ padding: "1rem 1.1rem", borderTop: "3px solid var(--color-warning)" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>⏳ تحت التحصيل</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--color-warning)" }}>{st?.inCollection ?? "—"}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>اتسلّم بس الكاش مع المندوب</div>
        </div>
      </div>

      {/* المحفظة (عرض فقط) */}
      {me.merchantId && <WalletPanel merchantId={me.merchantId} canDeposit={false} />}

      {/* إحصائيات الشحنات */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <MStat icon="📦" label="إجمالي الشحنات" value={toArabicDigits(stats.total)} onClick={goShip} />
        <MStat icon="🛵" label="في الطريق" value={toArabicDigits(stats.active)} onClick={goShip} />
        <MStat icon="✅" label="تم التسليم" value={toArabicDigits(stats.delivered)} tone="success" onClick={goShip} />
        <MStat icon="↩️" label="مرتجعات" value={toArabicDigits(stats.returns)} tone={stats.returns > 0 ? "warn" : undefined} onClick={goShip} />
      </div>

      <button className="btn btn-primary" style={{ padding: "0.85rem", fontSize: "1rem" }} onClick={onCreate}>➕ شحنة جديدة</button>
    </div>
  );
}

function MStat({ icon, label, value, tone, onClick }: { icon: string; label: string; value: string; tone?: "success" | "warn"; onClick?: () => void }) {
  const color = tone === "success" ? "var(--color-success)" : tone === "warn" ? "var(--color-warning)" : "var(--ink)";
  return (
    <button onClick={onClick} className="card" style={{ padding: "0.85rem 1rem", textAlign: "start", border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer" }}>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{icon} {label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color }}>{value}</div>
    </button>
  );
}

// ─────────────────────────── شحناتي ───────────────────────────
function ShipmentsTab({ rows, loading, onCreate }: { rows: ShipmentRow[]; loading: boolean; onCreate: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "delivered" | "returns">("all");

  const shown = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "delivered" && !DELIVERED_STATUSES.includes(r.status)) return false;
      if (filter === "returns" && !RETURN_STATUSES.includes(r.status)) return false;
      if (filter === "active" && (DELIVERED_STATUSES.includes(r.status) || RETURN_STATUSES.includes(r.status) || ["cancelled", "lost", "damaged", "disposed"].includes(r.status))) return false;
      if (q) {
        const hay = `${r.awb} ${r.recipient_name} ${r.recipient_phone}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, q, filter]);

  const chips: { k: typeof filter; label: string }[] = [
    { k: "all", label: "الكل" }, { k: "active", label: "في الطريق" },
    { k: "delivered", label: "متسلّمة" }, { k: "returns", label: "مرتجعات" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input className="input" placeholder="🔍 دوّر ببوليصة / اسم / موبايل" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={onCreate} style={{ whiteSpace: "nowrap" }}>➕</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
        {chips.map((c) => (
          <button key={c.k} onClick={() => setFilter(c.k)} style={{
            padding: "0.35rem 0.9rem", borderRadius: 100, fontSize: "0.82rem", fontWeight: 700, whiteSpace: "nowrap",
            border: "1px solid var(--border)", cursor: "pointer",
            background: filter === c.k ? "var(--color-orange-500)" : "var(--surface)",
            color: filter === c.k ? "#fff" : "var(--muted)",
          }}>{c.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>
      ) : shown.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem 1rem", textAlign: "center", color: "var(--muted)" }}>مفيش شحنات هنا</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {shown.map((s) => {
            const tone = toneStyle(statusTone(s.status));
            const hasCod = BigInt(s.cod_amount_p || "0") > 0n;
            return (
              <div key={s.id} className="card" style={{ padding: "0.85rem 1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800 }}>{s.recipient_name}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{s.governorate} · <span dir="ltr">{s.recipient_phone}</span></div>
                    <div dir="ltr" style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>{s.awb}</div>
                  </div>
                  <span className="badge" style={{ ...tone, whiteSpace: "nowrap" }}>{STATUS_LABELS_AR[s.status]}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <span style={{ fontWeight: 800, color: hasCod ? "var(--color-orange-600)" : "var(--muted)" }}>
                    {hasCod ? egp(s.cod_amount_p) : "بدون تحصيل"}
                  </span>
                  <Link href={`/shipments/${s.id}/label`} target="_blank" className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>🖨️ بوليصة</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── حسابي ───────────────────────────
function AccountTab({ me, st }: { me: Me; st: Statement | null }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem" }}>كشف حسابي</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card" style={{ padding: "1rem", textAlign: "center", borderTop: "3px solid var(--color-success)" }}>
          <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>✅ مؤكد</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--color-success)" }}>{st?.confirmed ?? "—"}</div>
        </div>
        <div className="card" style={{ padding: "1rem", textAlign: "center", borderTop: "3px solid var(--color-warning)" }}>
          <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>⏳ تحت التحصيل</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--color-warning)" }}>{st?.inCollection ?? "—"}</div>
        </div>
      </div>
      {me.merchantId && <WalletPanel merchantId={me.merchantId} canDeposit={false} />}

      <h3 style={{ margin: "0.3rem 0 0", fontSize: "0.95rem" }}>آخر الحركات</h3>
      <div className="card" style={{ overflow: "auto", padding: 0 }}>
        {!st || st.lines.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>مفيش حركات مالية لسه</div>
        ) : (
          <div>
            {st.lines.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.7rem 1rem", borderTop: i ? "1px solid var(--border)" : 0 }}>
                <div>
                  <div dir="ltr" style={{ fontWeight: 700, fontSize: "0.85rem", textAlign: "right" }}>{l.awb}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {KIND_LABEL[l.kind] ?? l.kind} · {l.settled ? "✅ متحوّل" : "قيد التسوية"}
                  </div>
                </div>
                <span style={{ fontWeight: 800, color: l.net.trim().startsWith("-") ? "var(--color-danger)" : "var(--ink)" }}>{l.net}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── المرتجعات ───────────────────────────
function ReturnsTab({ rows }: { rows: ShipmentRow[] }) {
  const returns = rows.filter((r) => RETURN_STATUSES.includes(r.status));
  return (
    <div>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>المرتجعات ({toArabicDigits(returns.length)})</h2>
      {returns.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem 1rem", textAlign: "center", color: "var(--muted)" }}>
          <div style={{ fontSize: "2rem" }}>👍</div>مفيش مرتجعات دلوقتي
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {returns.map((s) => {
            const tone = toneStyle(statusTone(s.status));
            return (
              <div key={s.id} className="card" style={{ padding: "0.85rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>{s.recipient_name}</div>
                  <div dir="ltr" style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>{s.awb}</div>
                </div>
                <span className="badge" style={tone}>{STATUS_LABELS_AR[s.status]}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── بياناتي + طلب استلام ───────────────────────────
function ProfileTab({ me, rows, onDone, logout }: { me: Me; rows: ShipmentRow[]; onDone: () => void; logout: () => void }) {
  const awaiting = rows.filter((r) => r.status === "awaiting_pickup");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function requestPickup() {
    if (!me.merchantId || awaiting.length === 0) return;
    if (addr.trim().length < 3) { setMsg({ kind: "err", text: "اكتب عنوان الاستلام" }); return; }
    setBusy(true); setMsg(null);
    const r = await apiCall<{ code: string; serviceFee: string }>("POST", "/api/v1/pickups", {
      merchantId: me.merchantId, shipmentIds: awaiting.map((s) => s.id), pickupAddress: addr,
    });
    setBusy(false);
    if (r.ok && r.data) { setMsg({ kind: "ok", text: `تم طلب الاستلام (${r.data.code}) — الرسم ${r.data.serviceFee}` }); setAddr(""); onDone(); }
    else setMsg({ kind: "err", text: r.error?.message ?? "فشل الطلب" });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem" }}>بياناتي</h2>
      <div className="card" style={{ padding: "1.2rem", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 54, height: 54, borderRadius: 14, background: "var(--color-orange-500)", color: "#fff", display: "grid", placeItems: "center", fontSize: "1.4rem", fontWeight: 800 }}>
          {me.name.trim().charAt(0)}
        </div>
        <div>
          <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{me.name}</div>
          <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>حساب تاجر</div>
        </div>
      </div>

      {/* طلب استلام */}
      <div className="card" style={{ padding: "1rem 1.2rem" }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>🚚 طلب استلام</div>
        {awaiting.length === 0 ? (
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>مفيش شحنات في انتظار الاستلام دلوقتي.</div>
        ) : (
          <>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 8 }}>
              عندك <b>{toArabicDigits(awaiting.length)}</b> شحنة في انتظار الاستلام.
              {awaiting.length < 5 && <span> (أقل من ٥ عليها رسم خدمة ٥٠ج)</span>}
            </div>
            <input className="input" placeholder="عنوان الاستلام" value={addr} onChange={(e) => setAddr(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
            <button className="btn btn-primary" onClick={requestPickup} disabled={busy} style={{ width: "100%" }}>
              {busy ? "..." : "اطلب استلام"}
            </button>
          </>
        )}
        {msg && <div style={{ marginTop: 8, fontSize: "0.82rem", fontWeight: 700, color: msg.kind === "ok" ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
      </div>

      <button className="btn btn-ghost" style={{ padding: "0.85rem", color: "var(--color-danger)", borderColor: "var(--color-danger)" }} onClick={logout}>تسجيل الخروج</button>
    </div>
  );
}
