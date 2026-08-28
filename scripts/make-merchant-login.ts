import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const [m] = await sql<{ id: string }[]>`SELECT id FROM merchants WHERE code LIKE 'M-2948%' OR name_ar='متجر الاختبار' ORDER BY created_at LIMIT 1`;
  if (!m) { console.log("no merchant found"); await sql.end(); return; }
  const h = await hashPassword("Shop12345");
  await sql`INSERT INTO users (full_name, username, password_hash, role, merchant_id, must_change_password)
    VALUES ('متجر الاختبار','shop1',${h},'merchant',${m.id}::uuid,false)
    ON CONFLICT (username) DO UPDATE SET password_hash=${h}, merchant_id=${m.id}::uuid, role='merchant', is_active=true`;
  console.log(`merchant login ready: shop1 / Shop12345 → merchant ${m.id}`);
  await sql.end();
}
main();
