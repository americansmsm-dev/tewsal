"use client";

/**
 * بانل CRM للتاجر — نوع المنتج، موظف المبيعات/الخدمة، نقاط الولاء،
 * الأسعار الخاصة، عناوين الاستلام. بيتعرض في صفحة التاجر للإدارة.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall } from "../lib/client";

interface Staff { id: string; full_name: string }
interface Override { id: string; zone: string; tier: string | null; price_p: string }
interface Address { id: string; label: string; address: string; governorate: string | null; is_default: boolean }
interface CrmData {
  merchant: { name_ar: string; product_type: string | null; allowed_weight_kg: string | null; points: string; flyer_balance: number; sales_rep_id: string | null; cs_rep_id: string | null; sales_rep_name: string | null; cs_rep_name: string | null };
  staff: Staff[];
  overrides: Override[];
  addresses: Address[];
  pointEvents: { delta: string; balance_after: string; reason_ar: string; created_at: string }[];
}
interface Zone { id: string; name_ar: string }

function egp(p: string): string {
  const v = BigInt(p || "0");
  return `${(v / 100n).toLocaleString("en-US")}.${(v % 100n).toString().padStart(2, "0")} ج`;
}

interface Product { id: string; sku: string; name_ar: string; quantity: number; price_p: string }

export function MerchantCrmPanel({ merchantId }: { merchantId: string }) {
  const [d, setD] = useState<CrmData | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [integ, setInteg] = useState<{ tokens: Record<string, unknown>[]; webhooks: Record<string, unknown>[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadProducts = useCallback(async () => { const r = await apiCall<{ products: Product[] }>("GET", `/api/v1/merchants/${merchantId}/products`); if (r.ok && r.data) setProducts(r.data.products); }, [merchantId]);
  const loadInteg = useCallback(async () => { const r = await apiCall<{ tokens: Record<string, unknown>[]; webhooks: Record<string, unknown>[] }>("GET", `/api/v1/merchants/${merchantId}/integrations`); if (r.ok && r.data) setInteg(r.data); }, [merchantId]);
  const load = useCallback(async () => {
    const r = await apiCall<CrmData>("GET", `/api/v1/merchants/${merchantId}/crm`);
    if (r.ok) setD(r.data);
  }, [merchantId]);
  useEffect(() => { if (open && !d) { load(); loadProducts(); loadInteg(); apiCall<{ zones: Zone[] }>("GET", "/api/v1/geo/zones").then((r) => setZones(r.data?.zones ?? [])); } }, [open, d, load, loadProducts, loadInteg]);

  async function stockAct(body: Record<string, unknown>, path: string, okMsg: string) {
    const r = await apiCall("POST", path, body);
    if (r.ok) { setMsg(okMsg); loadProducts(); setTimeout(() => setMsg(null), 2500); } else setMsg(r.error?.message ?? "فشل");
  }

  async function act(body: Record<string, unknown>, okMsg: string) {
    const r = await apiCall("POST", `/api/v1/merchants/${merchantId}/crm`, body);
    if (r.ok) { setMsg(okMsg); load(); setTimeout(() => setMsg(null), 2500); }
    else setMsg(r.error?.message ?? "فشل");
  }

  return (
    <div className="card" style={{ marginBottom: "1.25rem", overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", textAlign: "right", background: "none", border: "none", padding: "0.9rem 1.1rem", cursor: "pointer", fontWeight: 800, fontSize: "0.95rem", color: "var(--text)", display: "flex", justifyContent: "space-between" }}>
        <span>👤 بيانات التاجر و CRM</span>
        <span style={{ color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && d && (
        <div style={{ padding: "0 1.1rem 1.1rem", display: "grid", gap: "1.1rem" }}>
          {msg && <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--color-orange-600)" }}>{msg}</div>}

          {/* نقاط الولاء */}
          <Section title={`نقاط الولاء: ${d.merchant.points}`}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[50, 100, 500].map((n) => (
                <button key={n} className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => act({ action: "points", delta: n, reason: "مكافأة يدوية" }, `+${n} نقطة`)}>+{n}</button>
              ))}
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem", color: "var(--color-danger)" }} onClick={() => { const v = Number(window.prompt("عدد النقاط للاستبدال؟")); if (v > 0) act({ action: "points", delta: -v, reason: "استبدال" }, `−${v} نقطة`); }}>استبدال</button>
              {d.merchant.flyer_balance > 0 && <span style={{ fontSize: "0.8rem", color: "var(--muted)", alignSelf: "center" }}>· فلايرز: {d.merchant.flyer_balance}</span>}
            </div>
          </Section>

          {/* الحقول */}
          <Section title="الملف">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: "0.85rem" }}>
              <Field label="نوع المنتج" value={d.merchant.product_type} onSave={(v) => act({ action: "update", productType: v }, "اتحدّث")} />
              <Field label="الوزن المسموح (كجم)" value={d.merchant.allowed_weight_kg} numeric onSave={(v) => act({ action: "update", allowedWeightKg: v }, "اتحدّث")} />
              <RepField label="موظف المبيعات" current={d.merchant.sales_rep_name} staff={d.staff} onSave={(v) => act({ action: "update", salesRepId: v }, "اتحدّث")} />
              <RepField label="خدمة العملاء" current={d.merchant.cs_rep_name} staff={d.staff} onSave={(v) => act({ action: "update", csRepId: v }, "اتحدّث")} />
            </div>
          </Section>

          {/* الأسعار الخاصة */}
          <Section title="أسعار خاصة">
            {d.overrides.length === 0 ? <Muted>مفيش أسعار خاصة</Muted> : (
              <div style={{ display: "grid", gap: 4 }}>
                {d.overrides.map((o) => (
                  <div key={o.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.83rem", padding: "0.3rem 0" }}>
                    <span>{o.zone}{o.tier ? ` · ${o.tier}` : " · كل الشرائح"}</span><b>{egp(o.price_p)}</b>
                  </div>
                ))}
              </div>
            )}
            <AddOverride zones={zones} onAdd={(zoneId, tier, price) => act({ action: "override", zoneId, tier, price }, "اتسجّل سعر خاص")} />
          </Section>

          {/* عناوين الاستلام */}
          <Section title="عناوين الاستلام">
            {d.addresses.length === 0 ? <Muted>عنوان واحد افتراضي</Muted> : (
              <div style={{ display: "grid", gap: 4 }}>
                {d.addresses.map((a) => (
                  <div key={a.id} style={{ fontSize: "0.83rem" }}><b>{a.label}</b>{a.is_default ? " ⭐" : ""} — <span style={{ color: "var(--muted)" }}>{a.address}</span></div>
                ))}
              </div>
            )}
            <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem", marginTop: 6 }} onClick={() => { const label = window.prompt("اسم العنوان؟"); const address = label && window.prompt("العنوان؟"); if (label && address) act({ action: "address", label, address }, "اتسجّل عنوان"); }}>+ عنوان</button>
          </Section>

          {/* المخزون (فُلفيلمنت) */}
          <Section title="المخزون (فُلفيلمنت)">
            {products.length === 0 ? <Muted>مفيش منتجات مخزّنة</Muted> : (
              <div style={{ display: "grid", gap: 4 }}>
                {products.map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.83rem", padding: "0.3rem 0" }}>
                    <span><b>{p.name_ar}</b> <span style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>{p.sku}</span></span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button style={miniBtn} onClick={() => stockAct({ delta: -1 }, `/api/v1/products/${p.id}/stock`, "−1")}>−</button>
                      <b style={{ minWidth: 28, textAlign: "center", color: p.quantity <= 0 ? "var(--color-danger)" : undefined }}>{p.quantity}</b>
                      <button style={miniBtn} onClick={() => stockAct({ delta: 1 }, `/api/v1/products/${p.id}/stock`, "+1")}>+</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => { const sku = window.prompt("SKU؟"); const nameAr = sku && window.prompt("اسم المنتج؟"); const q = nameAr && window.prompt("الكمية؟", "0"); if (sku && nameAr) stockAct({ sku, nameAr, quantity: Number(q) || 0 }, `/api/v1/merchants/${merchantId}/products`, "اتسجّل منتج"); }}>+ منتج</button>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem", color: "var(--color-orange-600)" }} onClick={() => { const amt = window.prompt("مبلغ رسم التخزين (ج)؟"); if (amt) apiCall("POST", `/api/v1/merchants/${merchantId}/storage-fee`, { amount: amt }).then((r) => { setMsg(r.ok ? "اتحاسب رسم تخزين" : (r.error?.message ?? "فشل")); setTimeout(() => setMsg(null), 2500); }); }}>رسم تخزين</button>
            </div>
          </Section>

          {/* التكاملات — توكنات API + ويب-هوك */}
          <Section title="التكاملات (API + ويب-هوك)">
            {integ && integ.tokens.length > 0 && (
              <div style={{ display: "grid", gap: 3, marginBottom: 6 }}>
                {integ.tokens.map((t) => (
                  <div key={t.id as string} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                    <span style={{ fontFamily: "monospace" }}>{t.prefix as string}… {(t.is_active as boolean) ? "" : "(موقوف)"}</span>
                    {(t.is_active as boolean) && <button style={{ ...miniBtn, width: "auto", padding: "0 6px", color: "var(--color-danger)" }} onClick={() => apiCall("DELETE", `/api/v1/api-tokens/${t.id}`).then(loadInteg)}>إيقاف</button>}
                  </div>
                ))}
              </div>
            )}
            {integ && integ.webhooks.length > 0 && integ.webhooks.map((w) => (
              <div key={w.id as string} style={{ fontSize: "0.78rem", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}><span>🔔 {w.url as string}</span><button style={{ ...miniBtn, width: "auto", padding: "0 6px", color: "var(--color-danger)" }} onClick={() => apiCall("DELETE", `/api/v1/webhooks/${w.id}`).then(loadInteg)}>حذف</button></div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => { const name = window.prompt("اسم التوكن؟", "متجري"); if (name) apiCall<{ token: string }>("POST", `/api/v1/merchants/${merchantId}/integrations`, { action: "token", name }).then((r) => { if (r.ok && r.data) window.alert("التوكن (احفظه، مش هيتعرض تاني):\n\n" + r.data.token); loadInteg(); }); }}>+ توكن API</button>
              <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => { const url = window.prompt("رابط الويب-هوك (https)?"); if (url) apiCall("POST", `/api/v1/merchants/${merchantId}/integrations`, { action: "webhook", url }).then((r) => { setMsg(r.ok ? "اتسجّل ويب-هوك" : (r.error?.message ?? "فشل")); loadInteg(); setTimeout(() => setMsg(null), 2500); }); }}>+ ويب-هوك</button>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, numeric, onSave }: { label: string; value: string | null; numeric?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value ?? "");
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: 2 }}>{label}</div>
      <div style={{ display: "flex", gap: 4 }}>
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} inputMode={numeric ? "decimal" : undefined} style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem" }} />
        <button className="btn btn-ghost" style={{ padding: "0.35rem 0.6rem", fontSize: "0.78rem" }} onClick={() => onSave(v)}>حفظ</button>
      </div>
    </div>
  );
}
function RepField({ label, current, staff, onSave }: { label: string; current: string | null; staff: Staff[]; onSave: (v: string) => void }) {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: 2 }}>{label}{current ? ` (${current})` : ""}</div>
      <select className="input" defaultValue="" onChange={(e) => e.target.value && onSave(e.target.value)} style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem" }}>
        <option value="">— اختار —</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
    </div>
  );
}
function AddOverride({ zones, onAdd }: { zones: Zone[]; onAdd: (zoneId: string, tier: string | null, price: string) => void }) {
  const [zoneId, setZoneId] = useState(""); const [tier, setTier] = useState(""); const [price, setPrice] = useState("");
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
      <select className="input" value={zoneId} onChange={(e) => setZoneId(e.target.value)} style={{ flex: "1 1 120px", padding: "0.35rem 0.5rem", fontSize: "0.8rem" }}>
        <option value="">المنطقة</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name_ar}</option>)}
      </select>
      <select className="input" value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: 90, padding: "0.35rem 0.5rem", fontSize: "0.8rem" }}>
        <option value="">كل الشرائح</option><option value="t1">t1</option><option value="t2">t2</option><option value="t3">t3</option>
      </select>
      <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="سعر" inputMode="decimal" dir="ltr" style={{ width: 80, textAlign: "right", padding: "0.35rem 0.5rem", fontSize: "0.8rem" }} />
      <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }} disabled={!zoneId || !price} onClick={() => { onAdd(zoneId, tier || null, price); setPrice(""); }}>+</button>
    </div>
  );
}
const miniBtn: React.CSSProperties = { width: 24, height: 24, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontWeight: 800, color: "var(--text)", lineHeight: 1 };
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}><div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 6 }}>{title}</div>{children}</div>;
}
function Muted({ children }: { children: React.ReactNode }) { return <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{children}</div>; }
