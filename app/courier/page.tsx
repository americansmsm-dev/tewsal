"use client";

/**
 * تطبيق المندوب — موبايل أولًا، أزرار كبيرة، أرقام ضخمة.
 * بيعرض مهام اليوم (الشحنات اللي خرجت للتسليم مع المندوب)،
 * وكل شحنة عليها تسليم/تعذّر. المبلغ المطلوب تحصيله بأكبر خط.
 * حماية: لازم يكون الدور مندوب.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TransitionModal } from "../components/TransitionModal";
import { apiCall, toArabicDigits, type ShipmentStatus, type Role } from "../lib/client";
import { outboxCount, flushOutbox } from "../lib/outbox";

interface Me { id: string; name: string; role: string; }
interface Task {
  id: string;
  awb: string;
  status: ShipmentStatus;
  recipient_name: string;
  recipient_phone: string;
  address_line: string;
  landmark: string | null;
  cod_amount_p: string;
  governorate: string;
  current_courier_id: string | null;
}

function egp(p: string): string {
  const v = BigInt(p || "0");
  return `${toArabicDigits((v / 100n).toLocaleString("en-US"))}.${toArabicDigits((v % 100n).toString().padStart(2, "0"))}`;
}

export default function CourierApp() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cash, setCash] = useState<string>("—");
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Task | null>(null);
  const [att, setAtt] = useState<{ checkedIn: boolean; checkedOut: boolean } | null>(null);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    const [t, c, a] = await Promise.all([
      apiCall<{ shipments: Task[] }>("GET", "/api/v1/shipments?status=out_for_delivery&limit=100"),
      apiCall<{ cash: string }>("GET", "/api/v1/courier/cash"),
      apiCall<{ checkedIn: boolean; checkedOut: boolean }>("GET", "/api/v1/courier/field"),
    ]);
    if (t.ok) setTasks(t.data?.shipments ?? []);
    if (c.ok) setCash(c.data?.cash ?? "—");
    if (a.ok) setAtt(a.data);
    setPending(outboxCount());
    setLoading(false);
  }, []);

  async function attend(action: "check_in" | "check_out") {
    await apiCall("POST", "/api/v1/courier/field", { action });
    load();
  }

  // مزامنة الطابور الأوفلاين — أول ما النت يرجع + كل دقيقة
  useEffect(() => {
    async function sync() { const n = await flushOutbox(); setPending(outboxCount()); if (n > 0) load(); }
    sync();
    window.addEventListener("online", sync);
    const iv = setInterval(sync, 60000);
    return () => { window.removeEventListener("online", sync); clearInterval(iv); };
  }, [load]);

  // GPS أثناء الجولة — بس لو حاضر (بموافقة المتصفح)
  useEffect(() => {
    if (!att?.checkedIn || !navigator.geolocation) return;
    function ping() {
      navigator.geolocation.getCurrentPosition(
        (pos) => { apiCall("POST", "/api/v1/courier/field", { action: "location", lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }
      );
    }
    ping();
    const iv = setInterval(ping, 120000);
    return () => clearInterval(iv);
  }, [att?.checkedIn]);

  useEffect(() => {
    apiCall<{ user: Me }>("GET", "/api/v1/auth/me").then((r) => {
      if (!r.ok) return router.replace("/login");
      if (r.data!.user.role !== "courier") return router.replace("/");
      setMe(r.data!.user);
      load();
    });
  }, [router, load]);

  async function logout() {
    await apiCall("POST", "/api/v1/auth/logout");
    router.replace("/login");
  }

  if (!me) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", maxWidth: 520, margin: "0 auto" }}>
      <header style={{ background: "var(--color-navy-900)", color: "#fff", padding: "0.85rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>توص<span style={{ color: "var(--color-orange-500)" }}>ّل</span></div>
          <div style={{ fontSize: "0.72rem", opacity: 0.6 }}>{me.name}</div>
        </div>
        <button className="btn btn-ghost" onClick={logout} style={{ color: "#fff", borderColor: "#ffffff33", fontSize: "0.8rem" }}>خروج</button>
      </header>

      <main style={{ padding: "1rem" }}>
        {/* الحضور + مؤشر المزامنة */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "0.8rem", flexWrap: "wrap" }}>
          {att && (att.checkedOut ? (
            <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 700 }}>✓ انصرفت النهاردة</span>
          ) : att.checkedIn ? (
            <>
              <span style={{ fontSize: "0.85rem", color: "var(--color-success)", fontWeight: 700 }}>● حاضر · 📍 التتبّع شغّال</span>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.8rem", fontSize: "0.8rem", marginInlineStart: "auto" }} onClick={() => attend("check_out")}>انصراف</button>
            </>
          ) : (
            <button className="btn btn-primary" style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }} onClick={() => attend("check_in")}>تسجيل حضور</button>
          ))}
          {pending > 0 && <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-warning)", background: "#d9770618", padding: "0.25rem 0.6rem", borderRadius: 100 }}>⏳ غير متزامن: {toArabicDigits(pending)}</span>}
        </div>

        {/* عهدتي */}
        <div className="card" style={{ padding: "1rem 1.2rem", marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", borderInlineStart: "4px solid var(--color-orange-500)" }}>
          <div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>عهدتي (كاش معايا)</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--color-orange-600)" }}>{cash}</div>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", textAlign: "left", maxWidth: 130 }}>سلّمه للخزنة في نهاية اليوم</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>مهامي النهاردة</h2>
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{toArabicDigits(tasks.length)} شحنة</span>
        </div>

        {loading ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>
        ) : tasks.length === 0 ? (
          <div className="card" style={{ padding: "2.5rem 1rem", textAlign: "center", color: "var(--muted)" }}>
            <div style={{ fontSize: "2.5rem" }}>🎉</div>
            مفيش شحنات خارجة معاك دلوقتي
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {tasks.map((t) => {
              const hasCod = BigInt(t.cod_amount_p || "0") > 0n;
              return (
                <div key={t.id} className="card" style={{ padding: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{t.recipient_name}</div>
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{t.governorate} · {t.address_line}</div>
                      {t.landmark && <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>📍 {t.landmark}</div>}
                    </div>
                    <span dir="ltr" style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700 }}>{t.awb}</span>
                  </div>

                  {/* المبلغ المطلوب — أكبر خط */}
                  {hasCod && (
                    <div style={{ textAlign: "center", margin: "0.8rem 0", padding: "0.6rem", background: "var(--bg-soft)", borderRadius: 12 }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>المطلوب تحصيله</div>
                      <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--color-orange-600)" }}>{egp(t.cod_amount_p)} <span style={{ fontSize: "1rem" }}>ج</span></div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <a href={`tel:${t.recipient_phone}`} className="btn btn-ghost" style={{ flex: "0 0 auto", padding: "0.6rem 0.8rem" }}>📞</a>
                    <a href={`https://wa.me/2${t.recipient_phone}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ flex: "0 0 auto", padding: "0.6rem 0.8rem" }}>💬</a>
                    <button className="btn btn-primary" style={{ flex: 1, padding: "0.7rem" }} onClick={() => setActive(t)}>تسليم / تعذّر</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {active && (
        <TransitionModal
          shipmentId={active.id}
          awb={active.awb}
          currentStatus={active.status}
          currentCourierId={active.current_courier_id ?? me.id}
          role={"courier" as Role}
          onClose={() => setActive(null)}
          onDone={() => { setActive(null); load(); }}
        />
      )}
    </div>
  );
}
