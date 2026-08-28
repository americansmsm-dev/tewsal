import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
let cookie = "";
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  const s = sc.find((c) => c.startsWith("tewsal_session="));
  if (s) cookie = s.split(";")[0]!;
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  // مندوب بحساب دخول معروف
  const COURIER = "bbbbbbbb-9999-4000-8000-000000000001";
  const h = await hashPassword("Drive12345");
  await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
    VALUES (${COURIER}::uuid,'أحمد السائق','driver1',${h},'courier',false)
    ON CONFLICT (id) DO UPDATE SET password_hash=${h}, username='driver1', is_active=true`;

  await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" });
  const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
  const [m] = await sql<{ id: string }[]>`SELECT id FROM merchants WHERE name_ar='متجر الاختبار' LIMIT 1`;

  // شحنتين بتحصيل، ونوصّلهم لـ out_for_delivery مع driver1
  for (const cod of ["1250", "3400"]) {
    const s = await api("POST", "/api/v1/shipments", {
      merchantId: m!.id, recipientName: "خالد إبراهيم", recipientPhone: "01099998888",
      governorateId: gov!.id, addressLine: "مدينة نصر، عباس العقاد", codAmount: cod, confirm: true,
    });
    const id = s.json.id as string;
    const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: crypto.randomUUID(), courierId: COURIER });
    await tr({ to: "picked_up" });
    await tr({ to: "at_hub" });
    await tr({ to: "out_for_delivery", runSheetId: crypto.randomUUID(), courierId: COURIER });
  }
  console.log("courier demo ready: driver1 / Drive12345 — شحنتين out_for_delivery");
  await sql.end();
}
main();
