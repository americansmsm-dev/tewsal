"use client";

/**
 * صفحة التتبع العامة — بدون تسجيل دخول.
 * ⚠️ العميل بيشوف: خط زمني عربي، الموعد المتوقع، اسم ورقم
 *    المندوب (مقنّعين، بس لما يخرج للتسليم). مفيش مبلغ تحصيل
 *    ولا اسم تاجر ولا عنوان — دي الخصوصية اللي في الخطة.
 *    الـ QR في البوليصة بيوديّ هنا.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiCall } from "../../lib/client";

interface TimelineStep {
  status: string;
  label: string;
  at: string;
}
interface Track {
  awb: string;
  status: string;
  statusLabel: string;
  governorate: string;
  promisedAt: string | null;
  courier: { name: string; phone: string | null } | null;
  timeline: TimelineStep[];
}

const STEP_ICON: Record<string, string> = {
  awaiting_pickup: "📦",
  pickup_assigned: "📦",
  picked_up: "🚚",
  at_hub: "🏢",
  out_for_delivery: "🛵",
  delivery_failed: "⚠️",
  delivered: "✅",
  partially_delivered: "✅",
  awaiting_return: "↩️",
  returned_to_merchant: "↩️",
  cancelled: "🚫",
};

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function TrackPage() {
  const params = useParams<{ awb: string }>();
  const [data, setData] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    apiCall<Track>("GET", `/api/v1/track/${params.awb}`).then((r) => {
      if (r.ok) setData(r.data);
      else setError(r.error?.message ?? "تعذّر الوصول للشحنة");
      setLoading(false);
    });
  }, [params.awb]);

  const isDelivered = data?.status === "delivered" || data?.status === "partially_delivered";

  // نطوي الخطوات المتتالية اللي ليها نفس الرسالة (زي انتظار الاستلام
  // وإسناده — الاتنين بيظهروا للعميل بنفس الجملة)
  const steps = (data?.timeline ?? []).filter(
    (t, i, arr) => i === 0 || t.label !== arr[i - 1]?.label
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)" }}>
      {/* هيدر */}
      <header
        style={{
          background: "var(--color-navy-900)",
          color: "#fff",
          padding: "1rem 1.25rem",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>
          توص<span style={{ color: "var(--color-orange-500)" }}>ّل</span>
        </div>
        <div style={{ fontSize: "0.78rem", opacity: 0.7 }}>تتبع شحنتك</div>
      </header>

      <main style={{ maxWidth: 480, margin: "0 auto", padding: "1.25rem" }}>
        {loading ? (
          <Card><Center>جاري التحميل...</Center></Card>
        ) : error ? (
          <Card>
            <Center>
              <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🔍</div>
              <div style={{ fontWeight: 700 }}>{error}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 6 }}>
                اتأكد من رقم البوليصة وحاول تاني
              </div>
            </Center>
          </Card>
        ) : data ? (
          <>
            {/* الحالة الحالية */}
            <Card>
              <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
                <div style={{ fontSize: "3rem" }}>{STEP_ICON[data.status] ?? "📦"}</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: 4 }}>{data.statusLabel}</div>
                <div dir="ltr" style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 4 }}>
                  {data.awb}
                </div>
                {isDelivered && <RatingWidget awb={data.awb} />}
              </div>

              {data.promisedAt && !isDelivered && (
                <div
                  style={{
                    background: "var(--color-orange-100)",
                    color: "#7a3d00",
                    borderRadius: 12,
                    padding: "0.7rem",
                    textAlign: "center",
                    fontSize: "0.9rem",
                    fontWeight: 700,
                    marginTop: 12,
                  }}
                >
                  🕒 الموعد المتوقع: {fmtDate(data.promisedAt)}
                </div>
              )}

              {/* المندوب — بس لما يخرج للتسليم */}
              {data.courier && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "var(--bg-soft)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: "0.7rem 0.9rem",
                    marginTop: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>المندوب في الطريق إليك</div>
                    <div style={{ fontWeight: 800 }}>{data.courier.name}</div>
                  </div>
                  {data.courier.phone && (
                    <span dir="ltr" style={{ fontWeight: 700, color: "var(--color-orange-600)" }}>
                      {data.courier.phone}
                    </span>
                  )}
                </div>
              )}
            </Card>

            {/* الخط الزمني */}
            <Card style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: "0.95rem" }}>رحلة شحنتك</div>
              {steps.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>لسه في بداية الرحلة</div>
              ) : (
                <div style={{ position: "relative" }}>
                  {steps.map((t, i) => {
                    const last = i === steps.length - 1;
                    return (
                      <div key={i} style={{ display: "flex", gap: 12, paddingBottom: last ? 0 : "1.1rem", position: "relative" }}>
                        {/* الخط الرأسي */}
                        {!last && (
                          <div
                            style={{
                              position: "absolute",
                              right: 15,
                              top: 30,
                              bottom: 0,
                              width: 2,
                              background: "var(--border)",
                            }}
                          />
                        )}
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: last ? "var(--color-orange-500)" : "var(--bg-soft)",
                            border: `2px solid ${last ? "var(--color-orange-500)" : "var(--border)"}`,
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                            fontSize: "1rem",
                            zIndex: 1,
                          }}
                        >
                          {STEP_ICON[t.status] ?? "•"}
                        </div>
                        <div style={{ paddingTop: 4 }}>
                          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{t.label}</div>
                          <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{fmtDate(t.at)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* تواصل */}
            <a
              href="https://wa.me/201040039800"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 14 }}
            >
              💬 تواصل مع خدمة العملاء
            </a>
          </>
        ) : null}

        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.72rem", marginTop: 18 }}>
          توصّل للشحن — شركة شحن مصرية
        </p>
      </main>
    </div>
  );
}

function RatingWidget({ awb }: { awb: string }) {
  const [rated, setRated] = useState(0);
  const [done, setDone] = useState(false);
  if (done) return <div style={{ marginTop: 14, fontSize: "0.9rem", fontWeight: 700, color: "var(--color-success)" }}>شكرًا لتقييمك 💚</div>;
  async function rate(stars: number) {
    setRated(stars);
    await fetch("/api/public/v1/rate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ awb, stars }) });
    setTimeout(() => setDone(true), 400);
  }
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>قيّم خدمة التوصيل:</div>
      <div style={{ fontSize: "1.8rem", letterSpacing: 4 }}>
        {[1, 2, 3, 4, 5].map((s) => (
          <span key={s} onClick={() => rate(s)} style={{ cursor: "pointer", filter: s <= rated ? "none" : "grayscale(1) opacity(0.4)" }}>⭐</span>
        ))}
      </div>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={{ padding: "1.25rem", ...style }}>
      {children}
    </div>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ textAlign: "center", padding: "1rem 0" }}>{children}</div>;
}
