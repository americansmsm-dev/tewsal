/** قراءة حسابات الاختبار اللي global-setup عملها */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Account { username: string; password: string; id?: string }
export interface Accounts {
  admin: Account; accountant: Account; ops: Account; courier: Account;
  support: Account; dataEntry: Account; merchant: Account; govId: string;
}
export const accounts: Accounts = JSON.parse(
  readFileSync(join(process.cwd(), "e2e", ".accounts.json"), "utf8")
);

/** ملف حالة الجلسة لكل دور */
export const stateFile = (role: string) => join(process.cwd(), "e2e", ".auth", `${role}.json`);

export const ROLES = ["admin", "accountant", "ops", "courier", "support", "dataEntry", "merchant"] as const;
export type RoleKey = (typeof ROLES)[number];
