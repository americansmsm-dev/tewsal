/**
 * GET /api/v1/treasury — لوحة الخزينة.
 * أرصدة كاش المناديب + رصيد البنك والمحافظ والزيادة المعلّقة.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { courierCashBalances } from "@/server/services/handover";
import { requireRole } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** إجمالي كاش خزائن الفروع — الحساب ده لكل فرع (owner_id = الفرع) */
async function branchCashTotal(): Promise<bigint> {
  const rows = rowsOf<{ balance: string }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(jl.debit_p) - SUM(jl.credit_p), 0)::text AS balance
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = 'BRANCH_CASH'
    `)
  );
  return BigInt(rows[0]?.balance ?? "0");
}

/** رصيد حساب شركة بالكود */
async function companyBalance(code: string): Promise<bigint> {
  const rows = rowsOf<{ balance: string }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(jl.debit_p) - SUM(jl.credit_p), 0)::text AS balance
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = ${code} AND a.owner_id IS NULL
    `)
  );
  return BigInt(rows[0]?.balance ?? "0");
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE);
    const couriers = (await courierCashBalances(db)).map((c) => ({
      courierId: c.courierId,
      name: c.name ?? "مندوب",
      balance: formatEGP(BigInt(c.balanceP)),
      balanceP: c.balanceP,
      oldest: c.oldest,
    }));

    const [branchCash, bank, vodafone, instapay, suspense] = await Promise.all([
      branchCashTotal(),
      companyBalance("COMPANY_BANK"),
      companyBalance("EWALLET_VODAFONE"),
      companyBalance("EWALLET_INSTAPAY"),
      companyBalance("CASH_OVER_SUSPENSE"),
    ]);

    const courierTotal = couriers.reduce((s, c) => s + BigInt(c.balanceP), 0n);

    const wallets = vodafone + instapay;
    // إجمالي فلوس الشركة في كل مكان.
    // ⚠️ الزيادة المعلّقة **مش بتتجمع** — هي التزام، والكاش بتاعها
    //    محسوب أصلًا جوّه كاش الخزنة (وإلا كنا هنعدّه مرتين).
    const total = branchCash + courierTotal + bank + wallets;

    return ok({
      couriers,
      accounts: {
        branchCash: formatEGP(branchCash),
        courierCashTotal: formatEGP(courierTotal),
        bank: formatEGP(bank),
        vodafone: formatEGP(vodafone),
        instapay: formatEGP(instapay),
        wallets: formatEGP(wallets),
        suspense: formatEGP(-suspense), // التزام = رصيد دائن
        total: formatEGP(total),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
