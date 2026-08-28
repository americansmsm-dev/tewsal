"use client";

/**
 * إدارة الفريق — الموظفين والمناديب.
 * فتح حساب بيرجّع باسورد مؤقت بيتعرض مرة واحدة.
 */
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { apiCall } from "../lib/client";

interface TeamUser {
  id: string;
  full_name: string;
  username: string;
  phone: string | null;
  role: string;
  roleLabel: string;
  is_active: boolean;
  last_login_at: string | null;
}

const ROLE_OPTIONS = [
  { value: "ops", label: "العمليات والفرز" },
  { value: "courier", label: "مندوب" },
  { value: "accountant", label: "محاسب" },
  { value: "support", label: "خدمة العملاء" },
  { value: "branch_manager", label: "مدير فرع" },
];

export default function TeamPage() {
  const user = useCurrentUser();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCall<{ users: TeamUser[] }>("GET", "/api/v1/users");
    if (r.ok) setUsers(r.data?.users ?? []);
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
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", marginInlineEnd: "auto" }}>الفريق</h2>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + إضافة عضو
          </button>
        </div>

        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>الاسم</Th>
                <Th>اسم المستخدم</Th>
                <Th>الدور</Th>
                <Th>التليفون</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                    جاري التحميل...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                    مفيش أعضاء لسه — أضف أول موظف أو مندوب
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>
                      <span style={{ fontWeight: 700 }}>{u.full_name}</span>
                    </Td>
                    <Td>
                      <span dir="ltr" style={{ color: "var(--muted)" }}>
                        {u.username}
                      </span>
                    </Td>
                    <Td>
                      <span className="badge">{u.roleLabel}</span>
                    </Td>
                    <Td>
                      <span dir="ltr">{u.phone ?? "—"}</span>
                    </Td>
                    <Td>
                      <span
                        style={{
                          color: u.is_active ? "var(--color-success)" : "var(--muted)",
                          fontWeight: 700,
                          fontSize: "0.8rem",
                        }}
                      >
                        {u.is_active ? "● نشط" : "متوقف"}
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fullName: "", username: "", phone: "", role: "courier" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; username: string; tempPassword: string } | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    const body: Record<string, unknown> = { fullName: f.fullName, username: f.username, role: f.role };
    if (f.phone) body.phone = f.phone;
    const r = await apiCall<{ user: { full_name: string; username: string }; tempPassword: string }>(
      "POST",
      "/api/v1/users",
      body
    );
    setBusy(false);
    if (r.ok && r.data) {
      setCreated({ name: r.data.user.full_name, username: r.data.user.username, tempPassword: r.data.tempPassword });
    } else {
      setError(r.error?.message ?? "فشل إنشاء الحساب");
    }
  }

  if (created) {
    return (
      <Overlay onClose={onDone}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2.2rem" }}>✅</div>
          <h3 style={{ margin: "0.4rem 0" }}>اتفتح الحساب</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
            {created.name} — سلّمه البيانات دي، والباسورد بيتغيّر أول دخول
          </p>
          <div
            style={{
              background: "var(--bg-soft)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "0.85rem",
              textAlign: "right",
              marginBottom: "1rem",
            }}
          >
            <Row label="اسم المستخدم" value={created.username} />
            <Row label="الباسورد المؤقت" value={created.tempPassword} highlight />
          </div>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={onDone}>
            تمام
          </button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>عضو جديد</h3>
      <label className="label">الاسم الكامل</label>
      <input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} style={{ marginBottom: "0.8rem" }} />
      <div style={{ display: "flex", gap: 8, marginBottom: "0.8rem" }}>
        <div style={{ flex: 1 }}>
          <label className="label">اسم المستخدم</label>
          <input
            className="input"
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })}
            dir="ltr"
            style={{ textAlign: "right" }}
            placeholder="ahmed_ops"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">التليفون</label>
          <input
            className="input"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            dir="ltr"
            style={{ textAlign: "right" }}
            placeholder="01xxxxxxxxx"
          />
        </div>
      </div>
      <label className="label">الدور</label>
      <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={{ marginBottom: "1rem" }}>
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <ErrorBox msg={error} />}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={busy || f.fullName.length < 2 || f.username.length < 3}
          onClick={submit}
        >
          {busy ? "جاري..." : "فتح الحساب"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Overlay>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.35rem 0" }}>
      <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{label}</span>
      <span
        dir="ltr"
        style={{
          fontWeight: 800,
          fontFamily: "monospace",
          fontSize: highlight ? "1.05rem" : "0.95rem",
          color: highlight ? "var(--color-orange-600)" : "var(--text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Loading() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>
      جاري التحميل...
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.78rem", color: "var(--muted)" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.7rem 0.85rem", verticalAlign: "middle" }}>{children}</td>;
}
