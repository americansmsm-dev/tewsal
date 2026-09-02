"use client";

/**
 * تطبيق المندوب — موبايل أولًا بتبويبات سفلية (bottom nav):
 *  🏠 الرئيسية · 📋 مهامي · 💵 عهدتي · 💰 حسابي · 👤 بياناتي
 * أزرار كبيرة، أرقام ضخمة، بيشتغل أوفلاين (outbox) + GPS وقت الحضور.
 * حماية: لازم يكون الدور مندوب.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TransitionModal } from "../components/TransitionModal";
import { OrderDetailModal, LabelModal } from "../components/OrderModals";
import { ProfileCard } from "../components/ProfileCard";
import { InstallPrompt } from "../components/InstallPrompt";
import { apiCall, toArabicDigits, type ShipmentStatus, type Role } from "../lib/client";
import { outboxCount, flushOutbox } from "../lib/outbox";

interface Me { id: string; name: string; role: string; }
interface Task {
  id: string; awb: string; status: ShipmentStatus;
  recipient_name: string; recipient_phone: string;
  address_line: string; landmark: string | null;
  cod_amount_p: string; governorate: string; current_courier_id: string | null;
  merchant_name?: string;
}
interface Summary {
  cashInHand: string; commissions: string; receivable: string; receivableP: string;
  today: { delivered: number; failed: number; outForDelivery: number; successRate: number | null };
}
interface WorkHours { start: string | null; end: string | null; autoCheckout: boolean }
type Tab = "home" | "tasks" | "custody" | "earnings" | "profile";

/** وقت القاهرة HH:MM دلوقتي */
function cairoNow(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date());
}
/** هل دلوقتي داخل ساعات العمل؟ (لو مفيش ساعات محددة = دايمًا نعم) */
function withinHours(w: WorkHours | null): boolean {
  if (!w?.start || !w?.end) return true;
  const now = cairoNow();
  return now >= w.start && now <= w.end;
}

function egp(p: string): string {
  const v = BigInt(p || "0");
  return `${toArabicDigits((v / 100n).toLocaleString("en-US"))}.${toArabicDigits((v % 100n).toString().padStart(2, "0"))}`;
}

export default function CourierApp() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [labelId, setLabelId] = useState<string | null>(null);
  const [att, setAtt] = useState<{ checkedIn: boolean; checkedOut: boolean } | null>(null);
  const [work, setWork] = useState<WorkHours | null>(null);
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, s, a, w] = await Promise.all([
      apiCall<{ shipments: Task[] }>("GET", "/api/v1/shipments?status=pickup_assigned,picked_up,out_for_delivery,out_for_return&limit=100"),
      apiCall<Summary>("GET", "/api/v1/courier/summary"),
      apiCall<{ checkedIn: boolean; checkedOut: boolean }>("GET", "/api/v1/courier/field"),
      apiCall<WorkHours>("GET", "/api/v1/settings/work-hours"),
    ]);
    if (t.ok) setTasks(t.data?.shipments ?? []);
    if (s.ok) setSum(s.data);
    if (a.ok) setAtt(a.data);
    if (w.ok) setWork(w.data);
    setPending(outboxCount());
    setLoading(false);
  }, []);

  async function attend(action: "check_in" | "check_out") {
    const r = await apiCall("POST", "/api/v1/courier/field", { action });
    if (!r.ok) { setNotice(r.error?.message ?? "تعذّر تنفيذ العملية"); return; }
    setNotice(null);
    load();
  }

  useEffect(() => {
    async function sync() { const n = await flushOutbox(); setPending(outboxCount()); if (n > 0) load(); }
    sync();
    window.addEventListener("online", sync);
    const iv = setInterval(sync, 60000);
    return () => { window.removeEventListener("online", sync); clearInterval(iv); };
  }, [load]);

  useEffect(() => {
    // التتبّع بيشتغل بس وهو حاضر ولسه ماعملش انصراف — بيقف فورًا بالانصراف
    if (!att?.checkedIn || att?.checkedOut || !navigator.geolocation) return;
    function ping() {
      // برّه ساعات العمل: نوقف التتبّع، وننصرف تلقائي لو المدير مفعّلها
      if (!withinHours(work)) {
        if (work?.autoCheckout && work.end && cairoNow() > work.end) attend("check_out");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => { apiCall("POST", "/api/v1/courier/field", { action: "location", lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }
      );
    }
    ping();
    const iv = setInterval(ping, 120000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att?.checkedIn, att?.checkedOut, work?.start, work?.end, work?.autoCheckout]);

  useEffect(() => {
    apiCall<{ user: Me }>("GET", "/api/v1/auth/me").then((r) => {
      if (!r.ok) return router.replace("/login");
      if (r.data!.user.role !== "courier") return router.replace("/");
      setMe(r.data!.user);
      load();
    });
  }, [router, load]);

  // تحديث فوري تلقائي كل ٢٥ ثانية (وهو ظاهر بس)
  useEffect(() => {
    const iv = setInterval(() => { if (document.visibilityState === "visible") load(); }, 25000);
    return () => clearInterval(iv);
  }, [load]);

  async function logout() {
    await apiCall("POST", "/api/v1/auth/logout");
    router.replace("/login");
  }

  if (!me) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", maxWidth: 520, margin: "0 auto", paddingBottom: 72 }}>
      <InstallPrompt />
      <header style={{ background: "var(--color-navy-900)", color: "#fff", padding: "0.85rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>توص<span style={{ color: "var(--color-orange-500)" }}>ّل</span></div>
          <div style={{ fontSize: "0.72rem", opacity: 0.6 }}>{TAB_LABELS[tab]}</div>
        </div>
        {pending > 0 && <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#fff", background: "#d97706", padding: "0.25rem 0.6rem", borderRadius: 100 }}>⏳ غير متزامن: {toArabicDigits(pending)}</span>}
      </header>

      <main style={{ padding: "1rem" }}>
        {notice && (
          <div onClick={() => setNotice(null)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.9rem", padding: "0.75rem 0.9rem", borderRadius: 12, background: "#dc262618", border: "1px solid #dc262633", color: "#dc2626", fontSize: "0.86rem", fontWeight: 700, cursor: "pointer" }}>
            <span style={{ fontSize: "1.1rem" }}>⚠️</span>
            <span style={{ flex: 1 }}>{notice}</span>
            <span style={{ opacity: 0.6, fontSize: "0.75rem" }}>✕</span>
          </div>
        )}
        {tab === "home" && <HomeTab me={me} sum={sum} att={att} work={work} tasks={tasks} attend={attend} goTasks={() => setTab("tasks")} loading={loading} />}
        {tab === "tasks" && <TasksTab tasks={tasks} loading={loading} onPick={setActive} onDetail={setDetailTask} />}
        {tab === "custody" && <CustodyTab sum={sum} />}
        {tab === "earnings" && <EarningsTab sum={sum} />}
        {tab === "profile" && <ProfileTab att={att} logout={logout} />}
      </main>

      {/* الشريط السفلي */}
      <nav style={{
        position: "fixed", insetInlineStart: 0, insetInlineEnd: 0, bottom: 0, zIndex: 20,
        maxWidth: 520, margin: "0 auto", background: "var(--surface)", borderTop: "1px solid var(--border)",
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

      {active && (
        <TransitionModal
          shipmentId={active.id} awb={active.awb} currentStatus={active.status}
          currentCourierId={active.current_courier_id ?? me.id} role={"courier" as Role}
          expectedCodP={active.cod_amount_p}
          onClose={() => setActive(null)} onDone={() => { setActive(null); load(); }}
        />
      )}
      {detailTask && (
        <OrderDetailModal
          shipmentId={detailTask.id}
          onClose={() => setDetailTask(null)}
          onAction={() => { setActive(detailTask); setDetailTask(null); }}
          onLabel={() => { setLabelId(detailTask.id); setDetailTask(null); }}
        />
      )}
      {labelId && <LabelModal shipmentId={labelId} onClose={() => setLabelId(null)} />}
    </div>
  );
}

const TAB_LABELS: Record<Tab, string> = { home: "الرئيسية", tasks: "مهامي", custody: "عهدتي", earnings: "حسابي", profile: "بياناتي" };
const TAB_ICONS: Record<Tab, string> = { home: "🏠", tasks: "📋", custody: "💵", earnings: "💰", profile: "👤" };

// ─────────────────────────── الرئيسية ───────────────────────────
function HomeTab({ me, sum, att, work, tasks, attend, goTasks, loading }: {
  me: Me; sum: Summary | null; att: { checkedIn: boolean; checkedOut: boolean } | null;
  work: WorkHours | null; tasks: Task[]; attend: (a: "check_in" | "check_out") => void; goTasks: () => void; loading: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>أهلًا {me.name} 👋</div>

      {work?.start && work?.end && (
        <div style={{ fontSize: "0.8rem", color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.5rem 0.8rem" }}>
          🕐 ساعات العمل: {work.start} — {work.end}{work.autoCheckout ? " · انصراف تلقائي بالنهاية" : ""}
        </div>
      )}

      {/* الحضور */}
      <div className="card" style={{ padding: "0.9rem 1.1rem", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {att?.checkedOut ? (
          <span style={{ fontWeight: 700, color: "var(--muted)" }}>✓ انصرفت النهاردة</span>
        ) : att?.checkedIn ? (
          <>
            <span style={{ fontWeight: 700, color: "var(--color-success)" }}>● حاضر · 📍 التتبّع شغّال</span>
            <button className="btn btn-ghost" style={{ marginInlineStart: "auto", padding: "0.35rem 0.9rem", fontSize: "0.82rem" }} onClick={() => attend("check_out")}>انصراف</button>
          </>
        ) : (
          <button className="btn btn-primary" style={{ width: "100%", padding: "0.7rem" }} onClick={() => attend("check_in")}>تسجيل حضور وبدء الجولة</button>
        )}
      </div>

      {/* إجماليات النهاردة */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Stat icon="✅" label="تسليمات النهاردة" value={loading ? "…" : toArabicDigits(sum?.today.delivered ?? 0)} tone="success" />
        <Stat icon="🎯" label="نسبة النجاح" value={sum?.today.successRate == null ? "—" : `${toArabicDigits(sum.today.successRate)}٪`} />
        <Stat icon="🛵" label="مهامي" value={loading ? "…" : toArabicDigits(tasks.length)} />
        <Stat icon="⚠️" label="تعذّرت النهاردة" value={loading ? "…" : toArabicDigits(sum?.today.failed ?? 0)} tone={sum && sum.today.failed > 0 ? "warn" : undefined} />
      </div>

      {/* عهدة الكاش */}
      <div className="card" style={{ padding: "1rem 1.2rem", borderInlineStart: "4px solid var(--color-orange-500)" }}>
        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>الكاش معايا (العهدة)</div>
        <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--color-orange-600)" }}>{sum?.cashInHand ?? "—"}</div>
      </div>

      <button className="btn btn-primary" style={{ padding: "0.85rem", fontSize: "1rem" }} onClick={goTasks}>
        📋 شوف مهامي ({toArabicDigits(tasks.length)})
      </button>
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: string; label: string; value: string; tone?: "success" | "warn" }) {
  const color = tone === "success" ? "var(--color-success)" : tone === "warn" ? "var(--color-warning)" : "var(--ink)";
  return (
    <div className="card" style={{ padding: "0.85rem 1rem" }}>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{icon} {label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

// ─────────────────────────── مهامي ───────────────────────────
/** نوع المهمة حسب الحالة — استلام من التاجر / توصيل للعميل / إرجاع للتاجر */
interface TaskKind { badge: string; tone: string; btn: string; toMerchant: boolean; note?: string }
const DELIVERY_KIND: TaskKind = { badge: "🛵 توصيل للعميل", tone: "#16a34a", btn: "تسليم / تعذّر", toMerchant: false };
const TASK_KIND: Record<string, TaskKind> = {
  pickup_assigned: { badge: "📦 استلام من التاجر", tone: "#2563eb", btn: "تأكيد الاستلام", toMerchant: true },
  // بعد الاستلام من التاجر بتفضل في عهدة المندوب لحد ما مسؤول المخزن يستلمها (مفيش زرار — المخزن بيعمل الاستلام)
  picked_up: { badge: "📥 معايا — سلّمها للمخزن", tone: "#7c3aed", btn: "", toMerchant: true, note: "في عهدتك — سلّمها لمسؤول المخزن وهو هيستلمها على السيستم" },
  out_for_return: { badge: "↩️ إرجاع للتاجر", tone: "#d97706", btn: "تأكيد الإرجاع", toMerchant: true },
  out_for_delivery: DELIVERY_KIND,
};

function TasksTab({ tasks, loading, onPick, onDetail }: { tasks: Task[]; loading: boolean; onPick: (t: Task) => void; onDetail: (t: Task) => void }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>مهامي النهاردة</h2>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{toArabicDigits(tasks.length)} شحنة</span>
      </div>
      {loading ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>
      ) : tasks.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem 1rem", textAlign: "center", color: "var(--muted)" }}>
          <div style={{ fontSize: "2.5rem" }}>🎉</div>مفيش مهام معاك دلوقتي
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {tasks.map((t) => {
            const k = TASK_KIND[t.status] ?? DELIVERY_KIND;
            const hasCod = !k.toMerchant && BigInt(t.cod_amount_p || "0") > 0n;
            // للاستلام والإرجاع الطرف هو التاجر مش العميل — نعرض اسم التاجر ونخفي بيانات العميل الغلط
            const title = k.toMerchant ? `التاجر: ${t.merchant_name ?? "—"}` : t.recipient_name;
            return (
              <div key={t.id} className="card" style={{ padding: "1rem", borderInlineStart: `4px solid ${k.tone}` }}>
                <div style={{ display: "inline-block", fontSize: "0.72rem", fontWeight: 800, color: k.tone, marginBottom: "0.4rem" }}>{k.badge}</div>
                <div onClick={() => onDetail(t)} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{title} <span style={{ fontSize: "0.75rem", color: "var(--color-orange-600)", fontWeight: 700 }}>ℹ️ تفاصيل</span></div>
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{t.governorate}{!k.toMerchant && ` · ${t.address_line}`}</div>
                    {!k.toMerchant && t.landmark && <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>📍 {t.landmark}</div>}
                  </div>
                  <span dir="ltr" style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700 }}>{t.awb}</span>
                </div>
                {hasCod && (
                  <div style={{ textAlign: "center", margin: "0.8rem 0", padding: "0.6rem", background: "var(--bg-soft)", borderRadius: 12 }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>المطلوب تحصيله</div>
                    <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--color-orange-600)" }}>{egp(t.cod_amount_p)} <span style={{ fontSize: "1rem" }}>ج</span></div>
                  </div>
                )}
                {k.note ? (
                  <div style={{ marginTop: "0.8rem", padding: "0.6rem 0.8rem", background: "var(--bg-soft)", borderRadius: 10, fontSize: "0.8rem", color: "var(--muted)", textAlign: "center" }}>
                    ⏳ {k.note}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: "0.8rem" }}>
                    {!k.toMerchant && <>
                      <a href={`tel:${t.recipient_phone}`} className="btn btn-ghost" style={{ flex: "0 0 auto", padding: "0.6rem 0.8rem" }}>📞</a>
                      <a href={`https://wa.me/2${t.recipient_phone}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ flex: "0 0 auto", padding: "0.6rem 0.8rem" }}>💬</a>
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(t.governorate + " " + t.address_line)}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ flex: "0 0 auto", padding: "0.6rem 0.8rem" }}>🗺️</a>
                    </>}
                    <button className="btn btn-primary" style={{ flex: 1, padding: "0.7rem" }} onClick={() => onPick(t)}>{k.btn}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── عهدتي ───────────────────────────
function CustodyTab({ sum }: { sum: Summary | null }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem" }}>عهدتي</h2>
      <div className="card" style={{ padding: "1.4rem 1.2rem", textAlign: "center", borderTop: "3px solid var(--color-orange-500)" }}>
        <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>الكاش اللي معايا دلوقتي</div>
        <div style={{ fontSize: "2.6rem", fontWeight: 800, color: "var(--color-orange-600)" }}>{sum?.cashInHand ?? "—"} <span style={{ fontSize: "1.2rem" }}>ج</span></div>
      </div>
      <div className="card" style={{ padding: "1rem 1.2rem", background: "var(--bg-soft)" }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>📥 إزاي تسلّم العهدة؟</div>
        <div style={{ fontSize: "0.88rem", color: "var(--muted)", lineHeight: 1.7 }}>
          روح الخزينة في الفرع وسلّم المبلغ ده للكاشير. الكاشير هيعدّ الفلوس ويأكّد الاستلام على السيستم، وعهدتك هتتصفّى تلقائي.
          <br />⚠️ ماينفعش تسليم العهدة لو عندك تسليمات لسه <b>مش متزامنة</b>.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── حسابي ───────────────────────────
function EarningsTab({ sum }: { sum: Summary | null }) {
  const hasDebt = sum ? BigInt(sum.receivableP || "0") > 0n : false;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem" }}>حسابي</h2>
      <div className="card" style={{ padding: "1.2rem", textAlign: "center", borderTop: "3px solid var(--color-success)" }}>
        <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>عمولات مستحقة ليك</div>
        <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "var(--color-success)" }}>{sum?.commissions ?? "—"} <span style={{ fontSize: "1.1rem" }}>ج</span></div>
        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4 }}>بتتحسب على كل شحنة تسلّمها</div>
      </div>
      <div className="card" style={{ padding: "1rem 1.2rem", display: "flex", justifyContent: "space-between", alignItems: "center", borderInlineStart: hasDebt ? "4px solid var(--color-danger)" : "4px solid var(--border)" }}>
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>عليّ (عجز/ذمم)</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: hasDebt ? "var(--color-danger)" : "var(--ink)" }}>{sum?.receivable ?? "—"}</div>
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--muted)", textAlign: "left", maxWidth: 140 }}>
          {hasDebt ? "بيتخصم من عمولاتك أو بتسوية" : "مفيش عليك حاجة 👍"}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── بياناتي ───────────────────────────
function ProfileTab({ att, logout }: { att: { checkedIn: boolean; checkedOut: boolean } | null; logout: () => void }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem" }}>بياناتي</h2>
      <div className="card" style={{ padding: "1rem 1.2rem", display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--muted)" }}>حالة اليوم</span>
        <b>{att?.checkedOut ? "انصرفت" : att?.checkedIn ? "حاضر ●" : "لسه ماسجّلتش حضور"}</b>
      </div>
      <ProfileCard subtitle="مندوب توصيل" logout={logout} />
    </div>
  );
}
