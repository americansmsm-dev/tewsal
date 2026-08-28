import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const pw = process.argv.find((a) => a.startsWith("--pw="))?.slice(5) ?? "Admin12345";
  const h = await hashPassword(pw);
  await sql`UPDATE users SET password_hash = ${h}, failed_login_count = 0, locked_until = NULL, must_change_password = false WHERE username = 'admin'`;
  console.log(`admin reset ✓ pw=${pw}`);
  await sql.end();
}
main();
