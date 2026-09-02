"use client";

/**
 * إدارة التجار — قائمة + فتح حساب + رابط كشف الحساب.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../components/AppHeader";
import { AppNav } from "../components/AppNav";
import { Overlay, ErrorBox } from "../components/TransitionModal";
import { useCurrentUser } from "../lib/useCurrentUser";
import { useDebounce } from "../lib/useDebounce";
import { apiCall } from "../lib/client";

interface Merchant {
  id: string;
  code: string;
  name_ar: string;
  phone: string | null;
  tier: string;
  cod_enabled: boolean;
  is_active: boolean;
}

const TIER_LABEL: Record<string, string> = {
  t1: "أقل من ١٠٠",
  t2: "١٠٠ : ٤٠٠",
  t3: "أكتر من ٤٠٠",
};

export default function MerchantsPage() {
  const user = useCurrentUser();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const dq = useDebounce(q, 350);
  const [showCreate, setShowCreate] = useState(false);
  const [delMerchant, setDelMerchant] = useState<Merchant | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (dq) params.set("q", dq);
    const r = await apiCall<{ merchants: Merchant[] }>("GET", `/api/v1/merchants?${params}`);
    if (r.ok) setMerchants(r.data?.merchants ?? []);
    setLoading(false);
  }, [dq]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!user) return <Loading />;
  const canCreate = ["super_admin", "branch_manager"].includes(user.role);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader user={user} />
      <AppNav role={user.role} />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", marginInlineEnd: "auto" }}>التجار</h2>
          <input
            className="input"
            placeholder="بحث بالاسم أو الكود..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            style={{ maxWidth: 260 }}
          />
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + تاجر جديد
            </button>
          )}
        </div>

        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-soft)", textAlign: "right" }}>
                <Th>الكود</Th>
                <Th>الاسم</Th>
                <Th>الشريحة</Th>
                <Th>التحصيل</Th>
                <Th>الحالة</Th>
                <Th>كشف الحساب</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                    جاري التحميل...
                  </td>
                </tr>
              ) : merchants.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                    مفيش تجار لسه — افتح أول حساب تاجر
                  </td>
                </tr>
              ) : (
                merchants.map((m) => (
                  <tr key={m.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>
                      <span dir="ltr" style={{ fontWeight: 700 }}>
                        {m.code}
                      </span>
                    </Td>
                    <Td>{m.name_ar}</Td>
                    <Td>
                      <span className="badge">{TIER_LABEL[m.tier] ?? m.tier}</span>
                    </Td>
                    <Td>
                      {m.cod_enabled ? (
                        <span style={{ color: "var(--color-success)" }}>مفعّل</span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </Td>
                    <Td>
                      <span style={{ color: m.is_active ? "var(--color-success)" : "var(--muted)", fontWeight: 700, fontSize: "0.8rem" }}>
                        {m.is_active ? "● نشط" : "متوقف"}
                      </span>
                    </Td>
                    <Td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Link
                          href={`/merchants/${m.id}`}
                          className="btn btn-ghost"
                          style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
                        >
                          كشف الحساب ←
                        </Link>
                        {canCreate && (
                          <button className="btn btn-ghost" title="حذف التاجر"
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem", color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
                            onClick={() => setDelMerchant(m)}>🗑️</button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {delMerchant && (
        <DeleteMerchantModal
          merchant={delMerchant}
          onClose={() => setDelMerchant(null)}
          onDone={() => { setDelMerchant(null); load(); }}
        />
      )}
      {showCreate && (
        <CreateMerchantModal
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

function CreateMerchantModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: "", nameAr: "", phone: "", tier: "t1", codEnabled: true, loginUsername: "", loginPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<{ username: string; tempPassword: string; custom: boolean } | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    const body: Record<string, unknown> = {
      code: f.code,
      nameAr: f.nameAr,
      tier: f.tier,
      codEnabled: f.codEnabled,
    };
    if (f.phone) body.phone = f.phone;
    if (f.loginUsername.trim()) {
      body.loginUsername = f.loginUsername.trim();
      if (f.loginPassword) body.loginPassword = f.loginPassword;
    }
    const r = await apiCall<{ login: { username: string; tempPassword: string; custom: boolean } | null }>("POST", "/api/v1/merchants", body);
    setBusy(false);
    if (r.ok) {
      if (r.data?.login) setLogin(r.data.login);
      else onDone();
    } else setError(r.error?.message ?? "فشل فتح الحساب");
  }

  if (login) {
    return (
      <Overlay onClose={onDone}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2.2rem" }}>✅</div>
          <h3 style={{ margin: "0.4rem 0" }}>اتفتح حساب التاجر ودخوله</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 1rem" }}>سلّم التاجر البيانات دي{login.custom ? "" : " — الباسورد بيتغيّر أول دخول"}</p>
          <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 12, padding: "0.85rem", textAlign: "right", marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0" }}>
              <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>اسم الدخول</span>
              <span dir="ltr" style={{ fontWeight: 800, fontFamily: "monospace" }}>{login.username}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0" }}>
              <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{login.custom ? "الباسورد" : "الباسورد المؤقت"}</span>
              <span dir="ltr" style={{ fontWeight: 800, fontFamily: "monospace", fontSize: "1.05rem", color: "var(--color-orange-600)" }}>{login.tempPassword}</span>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={onDone}>تمام</button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>تاجر جديد</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: "0.8rem" }}>
        <div style={{ width: 130 }}>
          <label className="label">الكود</label>
          <input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} dir="ltr" style={{ textAlign: "right" }} placeholder="M-0001" />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">اسم التاجر / المتجر</label>
          <input className="input" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: "0.8rem" }}>
        <div style={{ flex: 1 }}>
          <label className="label">التليفون</label>
          <input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" style={{ textAlign: "right" }} placeholder="01xxxxxxxxx" />
        </div>
        <div style={{ width: 150 }}>
          <label className="label">الشريحة</label>
          <select className="input" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>
            <option value="t1">t1 — أقل من ١٠٠</option>
            <option value="t2">t2 — ١٠٠ : ٤٠٠</option>
            <option value="t3">t3 — أكتر من ٤٠٠</option>
          </select>
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.8rem", fontSize: "0.85rem" }}>
        <input type="checkbox" checked={f.codEnabled} onChange={(e) => setF({ ...f, codEnabled: e.target.checked })} />
        خدمة التحصيل مفعّلة
      </label>
      {/* حساب دخول التاجر — أساسي عشان يستخدم البوابة */}
      <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 12, padding: "0.85rem", marginBottom: "1rem" }}>
        <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 2 }}>🔑 حساب دخول التاجر</div>
        <div style={{ fontSize: "0.76rem", color: "var(--muted)", marginBottom: 8 }}>عشان التاجر يدخل البوابة. سيبهم فاضيين لو مش هتفتح له حساب دلوقتي.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label className="label">اسم الدخول (username)</label>
            <input className="input" value={f.loginUsername} onChange={(e) => setF({ ...f, loginUsername: e.target.value })} dir="ltr" style={{ textAlign: "right" }} placeholder="merchant1" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="label">الباسورد</label>
            <input className="input" value={f.loginPassword} onChange={(e) => setF({ ...f, loginPassword: e.target.value })} dir="ltr" style={{ textAlign: "right" }} placeholder="٨ حروف — أو فاضي لتلقائي" />
          </div>
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 6 }}>اسم الدخول: حروف إنجليزي وأرقام و _ . بس (من غير مسافات).</div>
      </div>
      {error && <ErrorBox msg={error} />}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !f.code || !f.nameAr} onClick={submit}>
          {busy ? "جاري..." : "فتح الحساب"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Overlay>
  );
}

interface Assess {
  name: string; payable: string; wallet: string; activeShipments: number; totalShipments: number;
  canDelete: boolean; mode: "hard" | "soft" | "blocked"; blockers: string[];
}
function DeleteMerchantModal({ merchant, onClose, onDone }: { merchant: Merchant; onClose: () => void; onDone: () => void }) {
  const [a, setA] = useState<Assess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiCall<Assess>("GET", `/api/v1/merchants/${merchant.id}`).then((r) => {
      if (r.ok && r.data) setA(r.data); else setError(r.error?.message ?? "تعذّر الفحص");
    });
  }, [merchant.id]);

  async function confirmDelete() {
    setBusy(true); setError(null);
    const r = await apiCall("DELETE", `/api/v1/merchants/${merchant.id}`);
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error?.message ?? "فشل الحذف");
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: "0.3rem" }}>حذف التاجر: {merchant.name_ar}</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 0, marginBottom: "1rem" }}>
        بنتأكد الأول إن مفيش فلوس ليه ولا علينا قبل الحذف.
      </p>
      {!a ? (
        <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--muted)" }}>{error ?? "جاري الفحص..."}</div>
      ) : (
        <>
          <div style={{ background: "var(--bg-soft)", borderRadius: 12, padding: "0.85rem", marginBottom: "1rem" }}>
            <Line label="رصيد التاجر (مستحقات)" value={a.payable} />
            <Line label="رصيد المحفظة" value={a.wallet} />
            <Line label="شحنات شغّالة" value={`${a.activeShipments}`} />
            <Line label="إجمالي الشحنات" value={`${a.totalShipments}`} />
          </div>

          {a.canDelete ? (
            <>
              <div style={{ background: "#16a34a12", border: "1px solid #16a34a33", borderRadius: 10, padding: "0.7rem 0.9rem", marginBottom: "1rem", fontSize: "0.85rem", color: "var(--color-success)", fontWeight: 600 }}>
                ✅ الحساب متسوّى — ينفع يتحذف.
                {a.mode === "soft" && <div style={{ color: "var(--muted)", fontWeight: 400, marginTop: 4 }}>عنده تاريخ شحنات، فهيتأرشف (يتوقف ويختفي من التشغيل) مع الحفاظ على سجل الفلوس القديم.</div>}
                {a.mode === "hard" && <div style={{ color: "var(--muted)", fontWeight: 400, marginTop: 4 }}>تاجر من غير أي تاريخ — هيتحذف نهائيًا.</div>}
              </div>
              {error && <ErrorBox msg={error} />}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1, background: "var(--color-danger)" }} disabled={busy} onClick={confirmDelete}>
                  {busy ? "جاري..." : a.mode === "hard" ? "احذف نهائيًا" : "أرشفة التاجر"}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ background: "#dc262612", border: "1px solid #dc262633", borderRadius: 10, padding: "0.7rem 0.9rem", marginBottom: "1rem", fontSize: "0.85rem", color: "var(--color-danger)", fontWeight: 600 }}>
                ⛔ مينفعش الحذف دلوقتي:
                <ul style={{ margin: "0.4rem 0 0", paddingInlineStart: "1.2rem", fontWeight: 500 }}>
                  {a.blockers.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
              <button className="btn btn-ghost" style={{ width: "100%" }} onClick={onClose}>تمام</button>
            </>
          )}
        </>
      )}
    </Overlay>
  );
}
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0" }}>
      <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{label}</span>
      <b dir="ltr">{value}</b>
    </div>
  );
}

function Loading() {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>جاري التحميل...</div>;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "0.7rem 0.85rem", fontWeight: 700, fontSize: "0.78rem", color: "var(--muted)" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.7rem 0.85rem", verticalAlign: "middle" }}>{children}</td>;
}
