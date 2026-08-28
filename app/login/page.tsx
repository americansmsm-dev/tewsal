"use client";

/**
 * صفحة تسجيل الدخول — أول شاشة.
 * بتنده POST /api/v1/auth/login؛ نجح → تحويل للوحة.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // لو مسجّل دخول بالفعل، حوّله للوحة
  useEffect(() => {
    apiCall("GET", "/api/v1/auth/me").then((r) => {
      if (r.ok) router.replace("/");
    });
  }, [router]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const r = await apiCall<{ user: { role: string } }>("POST", "/api/v1/auth/login", { username, password });
    setLoading(false);
    if (r.ok) {
      // التاجر بيروح بوابته؛ الموظفين للوحة العمليات
      const role = r.data?.user.role;
      router.replace(role === "merchant" ? "/portal" : role === "courier" ? "/courier" : "/");
    } else {
      setError(r.error?.message ?? "فشل الدخول");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "1.5rem",
        background:
          "radial-gradient(1200px 600px at 100% -10%, #17171d 0%, transparent 55%), var(--bg-soft)",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 400, padding: "2rem 1.75rem" }}>
        <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: "1.9rem",
              fontWeight: 800,
              letterSpacing: "-0.02em",
            }}
          >
            <span style={{ color: "var(--color-orange-500)" }}>توصّل</span>
          </div>
          <p style={{ color: "var(--muted)", marginTop: 6, fontSize: "0.9rem" }}>
            نظام إدارة الشحنات
          </p>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label className="label" htmlFor="u">
              اسم المستخدم أو رقم التليفون
            </label>
            <input
              id="u"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              dir="ltr"
              style={{ textAlign: "right" }}
            />
          </div>
          <div style={{ marginBottom: "1.25rem" }}>
            <label className="label" htmlFor="p">
              كلمة المرور
            </label>
            <input
              id="p"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              dir="ltr"
              style={{ textAlign: "right" }}
            />
          </div>

          {error && (
            <div
              style={{
                background: "#dc262618",
                color: "var(--color-danger)",
                border: "1px solid #dc262633",
                borderRadius: 12,
                padding: "0.6rem 0.85rem",
                fontSize: "0.85rem",
                marginBottom: "1rem",
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => submit()}
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={loading}
          >
            {loading ? "جاري الدخول..." : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
