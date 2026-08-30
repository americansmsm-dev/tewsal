/**
 * ============================================================
 *  محفظة التاجر — Prepaid Wallet
 * ------------------------------------------------------------
 *  التاجر بيشحن محفظته فلوس، وأي أوردر من غير تحصيل (الشحن على
 *  التاجر) بياخد شحنه من المحفظة. الشحنة ماتتعملش أصلًا لو الرصيد
 *  المتاح مايكفّيش الشحن.
 *
 *  الرصيد المتاح = رصيد الدفتر − المحجوز.
 *   • رصيد الدفتر = حركة حساب MERCHANT_WALLET (التزام: دائن − مدين)
 *   • المحجوز = مجموع شحن الأوردرات الـwallet اللي لسه مش نهائية
 *
 *  مفيش عمود "محجوز" ولا منطق تصفية — المحجوز بيتحسب من الحالة،
 *  فلو الأوردر اتلغى قبل التسليم الفلوس بترجع تلقائيًا (خرج من
 *  المحجوز والدفتر ماتغيّرش).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { buildWalletDepositEntry } from "../domain/ledger";
import { postEntry, type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) return (result as { rows: T[] }).rows;
  return [];
}

/** الحالات اللي بيتفكّ عندها الحجز (الأوردر خلص) */
export const WALLET_TERMINAL_STATUSES = [
  "delivered",
  "partially_delivered",
  "returned_to_merchant",
  "cancelled",
  "lost",
  "damaged",
  "disposed",
] as const;

export interface WalletBalance {
  /** رصيد الدفتر (اللي التاجر شحنه ناقص اللي اتخصم فعلًا) */
  ledgerP: bigint;
  /** محجوز لأوردرات من غير تحصيل لسه في الطريق */
  reservedP: bigint;
  /** المتاح للحجز على أوردرات جديدة = الدفتر − المحجوز */
  availableP: bigint;
}

export async function walletBalance(ex: SqlExecutor, merchantId: string): Promise<WalletBalance> {
  const [led] = rowsOf<{ balance: string }>(
    await ex.execute(sql`
      SELECT COALESCE(SUM(jl.credit_p - jl.debit_p), 0)::text AS balance
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = 'MERCHANT_WALLET' AND a.owner_id = ${merchantId}::uuid
    `)
  );
  const [res] = rowsOf<{ reserved: string }>(
    await ex.execute(sql`
      SELECT COALESCE(SUM(price_p), 0)::text AS reserved
      FROM shipments
      WHERE merchant_id = ${merchantId}::uuid
        AND is_wallet_order = true
        AND status NOT IN ('delivered','partially_delivered','returned_to_merchant','cancelled','lost','damaged','disposed')
    `)
  );
  const ledgerP = BigInt(led?.balance ?? "0");
  const reservedP = BigInt(res?.reserved ?? "0");
  return { ledgerP, reservedP, availableP: ledgerP - reservedP };
}

export interface DepositInput {
  merchantId: string;
  amountP: bigint;
  /** cash · bank · instapay · vodafone_cash */
  method: string;
  branchId?: string;
  actorUserId?: string | null;
}

/** شحن محفظة التاجر — بيكتب قيد إيداع في الدفتر */
export async function depositToWallet(ex: SqlExecutor, i: DepositInput): Promise<WalletBalance> {
  if (i.amountP <= 0n) throw new HttpError(400, "BAD_AMOUNT", "المبلغ لازم يكون أكبر من صفر");
  const merchant = rowsOf<{ id: string }>(
    await ex.execute(sql`SELECT id FROM merchants WHERE id = ${i.merchantId}::uuid AND is_active = true`)
  )[0];
  if (!merchant) throw new HttpError(404, "MERCHANT_NOT_FOUND", "التاجر مش موجود أو موقوف");

  // الكاش بيدخل خزنة فرع حقيقي — نحلّ الفرع (المُمرّر أو MAIN)
  let branchId = i.branchId;
  if (i.method === "cash" && !branchId) {
    branchId = rowsOf<{ id: string }>(
      await ex.execute(sql`SELECT id FROM branches WHERE code = 'MAIN' LIMIT 1`)
    )[0]?.id;
    if (!branchId) throw new HttpError(500, "NO_BRANCH", "مفيش فرع رئيسي — راجع البذور");
  }

  const depositId = crypto.randomUUID();
  await postEntry(
    ex,
    buildWalletDepositEntry({
      depositId,
      merchantId: i.merchantId,
      amountP: i.amountP,
      method: i.method,
      branchId,
    }),
    { actorUserId: i.actorUserId }
  );
  return walletBalance(ex, i.merchantId);
}
