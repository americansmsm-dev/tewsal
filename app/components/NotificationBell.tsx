"use client";

/**
 * جرس الإشعارات — بيبان في الهيدر لكل الأدوار.
 * بيعمل بولنج كل ٢٥ ثانية للـ feed، بيوري عدد غير المقروء،
 * وقايمة منسدلة بآخر الإشعارات. الضغط على إشعار بيعلّمه مقروء.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiCall } from "../lib/client";

interface Notif {
  id: string;
  event: string;
  title_ar: string;
  body_ar: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "دلوقتي";
  const m = Math.floor(s / 60);
  if (m < 60) return `من ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `من ${h} س`;
  const days = Math.floor(h / 24);
  return `من ${days} يوم`;
}

export function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await apiCall<{ notifications: Notif[]; unreadCount: number }>("GET", "/api/v1/notifications/feed?limit=20");
    if (r.ok && r.data) {
      setItems(r.data.notifications);
      setUnread(r.data.unreadCount);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    return () => clearInterval(t);
  }, [load]);

  // إغلاق القايمة لما تدوس بره
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function markRead(id: string) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, is_read: true } : x)));
    setUnread((u) => Math.max(0, u - 1));
    await apiCall("POST", "/api/v1/notifications/read", { id });
  }
  async function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
    await apiCall("POST", "/api/v1/notifications/read", { all: true });
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="btn btn-ghost"
        style={{ padding: "0.4rem 0.6rem", color: "#fff", borderColor: "#ffffff33", position: "relative" }}
        title="الإشعارات"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -4, insetInlineEnd: -4, minWidth: 18, height: 18, padding: "0 4px",
            background: "var(--color-orange-500)", color: "#fff", borderRadius: 9,
            fontSize: "0.68rem", fontWeight: 800, display: "grid", placeItems: "center", lineHeight: 1,
          }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", insetInlineEnd: 0, top: "calc(100% + 8px)", width: 340, maxWidth: "90vw",
          background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--border)",
          borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.25)", zIndex: 50, overflow: "hidden",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.7rem 0.9rem", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 800, fontSize: "0.9rem" }}>الإشعارات</span>
            {unread > 0 && (
              <button onClick={markAll} className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}>
                تعليم الكل مقروء
              </button>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {items.length === 0 ? (
              <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
                مفيش إشعارات
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => { if (!n.is_read) markRead(n.id); }}
                  style={{
                    display: "block", width: "100%", textAlign: "right", padding: "0.7rem 0.9rem",
                    borderBottom: "1px solid var(--border)", cursor: "pointer",
                    background: n.is_read ? "transparent" : "var(--bg-soft)",
                    border: "none", borderInlineStart: n.is_read ? "3px solid transparent" : "3px solid var(--color-orange-500)",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 2 }}>{n.title_ar}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.5 }}>{n.body_ar}</div>
                  <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                </button>
              ))
            )}
          </div>
          <div style={{ padding: "0.6rem 0.9rem", borderTop: "1px solid var(--border)", textAlign: "center" }}>
            <Link href="/notifications" onClick={() => setOpen(false)} style={{ fontSize: "0.8rem", color: "var(--color-orange-600)", fontWeight: 700 }}>
              كل الإشعارات
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
