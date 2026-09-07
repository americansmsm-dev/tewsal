"use client";

/**
 * صفحة الإشعارات — صندوق الوارد الكامل لكل مستخدم + مُرسِل يدوي للإدارة.
 * المالك يقدر يبعت إشعار لأي دور/تاجر/مندوب/الكل براحته.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";
import { pushState, subscribeToPush, unsubscribeFromPush, type PushState } from "../lib/push";

interface Notif {
  id: string;
  event: string;
  title_ar: string;
  body_ar: string;
  is_read: boolean;
  created_at: string;
}
interface Merchant { id: string; name_ar: string; code: string }
interface Courier { id: string; full_name: string }

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "courier", label: "المناديب" },
  { value: "merchant", label: "التجار" },
  { value: "accountant", label: "المحاسبين" },
  { value: "ops", label: "مسؤولي المخزن" },
  { value: "data_entry", label: "موظفي إدخال البيانات" },
  { value: "branch_manager", label: "مديري الفروع" },
  { value: "support", label: "خدمة العملاء" },
];

export default function NotificationsPage() {
  // الإشعارات شاشة مشتركة — التاجر والمندوب لازم يوصلوها من الجرس
  const user = useCurrentUser({ allowPortalRoles: true });
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await apiCall<{ notifications: Notif[] }>("GET", "/api/v1/notifications/feed?limit=100");
    if (r.ok && r.data) setItems(r.data.notifications);
    setLoading(false);
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  async function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, is_read: true })));
    await apiCall("POST", "/api/v1/notifications/read", { all: true });
  }

  if (!user) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
  const canSend = ["super_admin", "branch_manager"].includes(user.role);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main className="page-main" style={{ maxWidth: 820, margin: "0 auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.15rem" }}>الإشعارات</h2>

        <DeviceSettings />

        {canSend && <Composer onSent={load} />}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 0.6rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>📥 صندوق الوارد</h3>
          {items.some((x) => !x.is_read) && (
            <button className="btn btn-ghost" onClick={markAll} style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>
              تعليم الكل مقروء
            </button>
          )}
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>جاري التحميل...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>مفيش إشعارات لسه</div>
          ) : (
            items.map((n) => (
              <div key={n.id} style={{
                padding: "0.8rem 1rem", borderBottom: "1px solid var(--border)",
                borderInlineStart: n.is_read ? "3px solid transparent" : "3px solid var(--color-orange-500)",
                background: n.is_read ? "transparent" : "var(--bg-soft)",
              }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{n.title_ar}</div>
                <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: 2, lineHeight: 1.6 }}>{n.body_ar}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>{new Date(n.created_at).toLocaleString("ar-EG")}</div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

function Composer({ onSent }: { onSent: () => void }) {
  const [type, setType] = useState<"all" | "role" | "merchant" | "courier">("all");
  const [roleVal, setRoleVal] = useState("courier");
  const [merchantId, setMerchantId] = useState("");
  const [courierId, setCourierId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);

  useEffect(() => {
    apiCall<{ merchants: Merchant[] }>("GET", "/api/v1/merchants?limit=500").then((r) => { if (r.ok && r.data) setMerchants(r.data.merchants); });
    apiCall<{ couriers: Courier[] }>("GET", "/api/v1/couriers").then((r) => { if (r.ok && r.data) setCouriers(r.data.couriers); });
  }, []);

  async function send() {
    if (!title.trim() || !body.trim()) { setMsg({ kind: "err", text: "اكتب العنوان والنص" }); return; }
    let value: string | null = null;
    if (type === "role") value = roleVal;
    else if (type === "merchant") { value = merchantId; if (!value) { setMsg({ kind: "err", text: "اختار التاجر" }); return; } }
    else if (type === "courier") { value = courierId; if (!value) { setMsg({ kind: "err", text: "اختار المندوب" }); return; } }

    const label = type === "all" ? "كل المستخدمين" : type === "role" ? ROLE_OPTIONS.find((r) => r.value === roleVal)?.label
      : type === "merchant" ? merchants.find((m) => m.id === merchantId)?.name_ar : couriers.find((c) => c.id === courierId)?.full_name;
    if (!confirm(`تأكيد إرسال الإشعار لـ «${label}»؟`)) return;

    setBusy(true); setMsg(null);
    const r = await apiCall<{ sent: number }>("POST", "/api/v1/notifications/send", { target: { type, value }, title, body });
    setBusy(false);
    if (r.ok && r.data) {
      setMsg({ kind: "ok", text: `تم الإرسال لـ ${r.data.sent} مستخدم` });
      setTitle(""); setBody("");
      onSent();
    } else {
      setMsg({ kind: "err", text: r.error?.message ?? "فشل الإرسال" });
    }
  }

  return (
    <div className="card" style={{ padding: "1.1rem 1.25rem", marginBottom: "1.5rem" }}>
      <h3 style={{ margin: "0 0 0.3rem", fontSize: "1rem" }}>✉️ ابعت إشعار</h3>
      <p style={{ margin: "0 0 0.9rem", color: "var(--muted)", fontSize: "0.8rem" }}>اختار لمين، اكتب الرسالة، وابعت. بيوصل جوّه السيستم فورًا.</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {([["all", "الكل"], ["role", "دور"], ["merchant", "تاجر"], ["courier", "مندوب"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setType(v)} className={type === v ? "btn btn-primary" : "btn btn-ghost"}
            style={{ padding: "0.35rem 0.9rem", fontSize: "0.83rem" }}>{l}</button>
        ))}
      </div>

      {type === "role" && (
        <select className="input" value={roleVal} onChange={(e) => setRoleVal(e.target.value)} style={{ marginBottom: 10, width: "100%" }}>
          {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      )}
      {type === "merchant" && (
        <select className="input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} style={{ marginBottom: 10, width: "100%" }}>
          <option value="">— اختار التاجر —</option>
          {merchants.map((m) => <option key={m.id} value={m.id}>{m.name_ar} ({m.code})</option>)}
        </select>
      )}
      {type === "courier" && (
        <select className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)} style={{ marginBottom: 10, width: "100%" }}>
          <option value="">— اختار المندوب —</option>
          {couriers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
      )}

      <input className="input" placeholder="عنوان الإشعار" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} style={{ width: "100%", marginBottom: 8 }} />
      <textarea className="input" placeholder="نص الرسالة" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3} style={{ width: "100%", marginBottom: 10, resize: "vertical" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={send} disabled={busy}>{busy ? "جاري الإرسال..." : "إرسال"}</button>
        {msg && <span style={{ fontSize: "0.83rem", fontWeight: 600, color: msg.kind === "ok" ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</span>}
      </div>
    </div>
  );
}

/**
 * إعدادات الإشعارات على الجهاز.
 *
 * ⚠️ طلب الإذن **لازم** من ضغطة مستخدم — عشان كده زرار مش
 *    تفعيل تلقائي. وعلى الآيفون/الآيباد لازم «إضافة إلى الشاشة
 *    الرئيسية» الأول (شرط آبل).
 */
interface Device { id: string; device_label: string | null; user_agent: string | null; last_seen_at: string }

function DeviceSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setState(await pushState());
    const r = await apiCall<{ devices: Device[] }>("GET", "/api/v1/push/devices");
    if (r.ok && r.data) setDevices(r.data.devices);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function enable() {
    setBusy(true);
    await subscribeToPush().catch(() => false);
    setBusy(false);
    void refresh();
  }
  async function disable() {
    setBusy(true);
    await unsubscribeFromPush().catch(() => false);
    setBusy(false);
    void refresh();
  }
  async function removeDevice(id: string) {
    if (!confirm("تشيل الجهاز ده من الإشعارات؟")) return;
    await apiCall("DELETE", `/api/v1/push/devices?id=${id}`);
    void refresh();
  }

  if (state === null) return null;

  const hint =
    state === "unsupported" ? "المتصفح ده مابيدعمش إشعارات الجهاز. على الآيفون لازم تضيف التطبيق للشاشة الرئيسية الأول."
    : state === "not-configured" ? "إشعارات الجهاز لسه مش متظبطة على السيرفر — الإشعارات جوّه السيستم شغّالة عادي."
    : state === "denied" ? "الإشعارات مرفوضة من إعدادات المتصفح. افتح إعدادات الموقع واسمح بالإشعارات."
    : state === "granted" ? "الجهاز ده مفعّل ✅"
    : "مش مفعّل على الجهاز ده.";

  return (
    <div className="card" style={{ padding: "0.9rem 1.1rem", marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "1.2rem" }}>🔔</span>
        {/* minWidth صغيّر عشان النص يلفّ بدل ما يزقّ الأزرار برّه الشاشة */}
        <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>إشعارات الجهاز</div>
          <div style={{ fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.6 }}>{hint}</div>
        </div>
        {state === "askable" && (
          <button className="btn btn-primary" onClick={enable} disabled={busy} style={{ padding: "0.4rem 0.9rem", fontSize: "0.83rem" }}>
            {busy ? "..." : "فعّل على الجهاز ده"}
          </button>
        )}
        {state === "granted" && (
          <button className="btn btn-ghost" onClick={disable} disabled={busy} style={{ padding: "0.4rem 0.9rem", fontSize: "0.83rem" }}>
            {busy ? "..." : "وقّف على الجهاز ده"}
          </button>
        )}
        {devices.length > 0 && (
          <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)} style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}>
            {open ? "إخفاء" : `أجهزتي (${devices.length})`}
          </button>
        )}
      </div>

      {open && devices.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          {devices.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.35rem 0", fontSize: "0.82rem", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 10rem", minWidth: 0 }}>
                <b>{d.device_label ?? "جهاز"}</b>
                <span style={{ color: "var(--muted)", fontSize: "0.74rem" }}>
                  {" · آخر ظهور "}{new Date(d.last_seen_at).toLocaleString("ar-EG")}
                </span>
              </span>
              <button className="btn btn-ghost" onClick={() => removeDevice(d.id)} style={{ padding: "0.2rem 0.6rem", fontSize: "0.75rem" }}>
                شيل
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
