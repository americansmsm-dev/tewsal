/**
 * ============================================================
 *  خدمة الدفتر — الكتابة الفعلية في قاعدة البيانات
 * ------------------------------------------------------------
 *  `domain/ledger.ts` بيبني القيد (منطق خالص).
 *  الملف ده بيكتبه — **جوه ترانزاكشن دايمًا**.
 *
 *  ⚠️ ٣ حاجات بتحصل هنا وبس:
 *   ١) تحويل مرجع الحساب (كود + مالك) لـ account_id حقيقي،
 *      وإنشاء حساب المندوب/التاجر من القالب لو أول مرة.
 *   ٢) كتابة القيد وسطوره.
 *   ٣) سيبان قاعدة البيانات ترفض غير المتوازن — مش بنفحص
 *      إحنا تاني، عشان الضمان يفضل في القاعدة مش في الكود.
 *
 *  الأخطاء بترجع بالعربي عشان الموظف يفهمها.
 * ============================================================
 */
import { sql, type SQL } from "drizzle-orm";
import type { AccountRef, DraftEntry } from "../domain/ledger";
import { accountKey } from "../domain/ledger";

/**
 * أي عميل قاعدة بيانات بينفّذ SQL — `db` أو `tx`.
 * مكتوب كده عشان الدالة **تجبر** المستدعي إنه يبقى جوه
 * ترانزاكشن، من غير ما نربطها بنوع Drizzle بعينه.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** توحيد شكل النتيجة بين postgres.js (مصفوفة) و node-postgres ({rows}) */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

// ---------------------------------------------------------------
// حل مراجع الحسابات
// ---------------------------------------------------------------

/** الحسابات اللي ليها نسخة مستقلة لكل مالك */
const OWNER_TYPE_OF: Record<string, "courier" | "merchant" | "branch" | "company"> = {
  COURIER_CASH: "courier",
  COURIER_RECEIVABLE: "courier",
  COURIER_COMMISSION_PAYABLE: "courier",
  MERCHANT_PAYABLE: "merchant",
  BRANCH_CASH: "branch",
};

/** أسماء عربية للحسابات اللي بتتعمل تلقائيًا */
const OWNED_ACCOUNT_NAME: Record<string, string> = {
  COURIER_CASH: "كاش المندوب",
  COURIER_RECEIVABLE: "ذمم على المندوب",
  COURIER_COMMISSION_PAYABLE: "عمولات مستحقة للمندوب",
  MERCHANT_PAYABLE: "مستحقات التاجر",
  BRANCH_CASH: "خزنة الفرع",
};

const ACCOUNT_TYPE_OF: Record<string, string> = {
  COURIER_CASH: "asset",
  COURIER_RECEIVABLE: "asset",
  BRANCH_CASH: "asset",
  COMPANY_BANK: "asset",
  COURIER_COMMISSION_PAYABLE: "liability",
  MERCHANT_PAYABLE: "liability",
};

/**
 * بيرجّع `account_id` لمرجع حساب، وبيعمله لو مش موجود.
 *
 * ⚠️ الحساب بيتعمل **مرة واحدة بس** لكل مالك — الفهرس الفريد
 *    هو الضمان، مش الكود. لو اتنين طلبوا نفس الحساب في نفس
 *    اللحظة، واحد بس هيكسب والتاني هيقرا اللي اتعمل.
 */
export async function resolveAccountId(
  ex: SqlExecutor,
  ref: AccountRef
): Promise<string> {
  const ownerId = ref.ownerId ?? null;

  // حساب شركة (بدون مالك) — لازم يكون في البذور
  if (ownerId === null) {
    const found = rowsOf<{ id: string }>(
      await ex.execute(
        sql`SELECT id FROM accounts WHERE code = ${ref.code} AND owner_id IS NULL LIMIT 1`
      )
    );
    if (!found[0]) {
      throw new Error(
        `الحساب "${ref.code}" مش موجود في دليل الحسابات — شغّل \`npm run db:seed\``
      );
    }
    return found[0].id;
  }

  // ⚠️ الحساب البنكي بيتخزن كحساب شركة (owner_id NULL) حتى لو
  //    الكود بيمرّر اسم الحساب — الاسم بيتحدد من الإعدادات.
  if (ref.code === "COMPANY_BANK") {
    return resolveAccountId(ex, { code: "COMPANY_BANK", ownerId: null });
  }

  const found = rowsOf<{ id: string }>(
    await ex.execute(
      sql`SELECT id FROM accounts WHERE code = ${ref.code} AND owner_id = ${ownerId}::uuid LIMIT 1`
    )
  );
  if (found[0]) return found[0].id;

  // أول عملية للمندوب/التاجر ده — بنعمل حسابه من القالب
  const ownerType = OWNER_TYPE_OF[ref.code];
  const accountType = ACCOUNT_TYPE_OF[ref.code];
  if (!ownerType || !accountType) {
    throw new Error(`الحساب "${ref.code}" مش من الحسابات اللي بتتعمل لكل مالك`);
  }

  const created = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO accounts (code, name_ar, type, owner_type, owner_id, is_template)
      VALUES (${ref.code}, ${OWNED_ACCOUNT_NAME[ref.code] ?? ref.code}, ${accountType},
              ${ownerType}, ${ownerId}::uuid, false)
      ON CONFLICT (code, owner_id) DO UPDATE SET code = EXCLUDED.code
      RETURNING id
    `)
  );
  if (!created[0]) {
    throw new Error(`مقدرناش نعمل حساب "${ref.code}" للمالك ${ownerId}`);
  }
  return created[0].id;
}

// ---------------------------------------------------------------
// كتابة القيد
// ---------------------------------------------------------------

export interface PostedEntry {
  entryId: string;
  entryNo: bigint;
}

/**
 * كتابة قيد في الدفتر.
 *
 * ⚠️ لازم يتنده **جوه ترانزاكشن** مع باقي التغييرات (تغيير
 *    حالة الشحنة مثلًا) — عشان لو أي حاجة فشلت، مفيش قيد
 *    يتيم في الدفتر.
 *
 * لو العملية اتقيّدت قبل كده، بيرمي خطأ واضح بدل ما يكرّر —
 * الفهرس `je_source_kind_uq` هو اللي بيمسك ده.
 */
export async function postEntry(
  ex: SqlExecutor,
  draft: DraftEntry,
  opts: { actorUserId?: string | null; entryDate?: Date } = {}
): Promise<PostedEntry> {
  if (draft.lines.length < 2) {
    throw new Error(`القيد "${draft.descriptionAr}" لازم يكون فيه سطرين على الأقل`);
  }

  // حل كل الحسابات الأول — لو حساب ناقص، منكتبش أي حاجة
  const accountIds = new Map<string, string>();
  for (const line of draft.lines) {
    const key = accountKey(line.account);
    if (!accountIds.has(key)) {
      accountIds.set(key, await resolveAccountId(ex, line.account));
    }
  }

  let entryId: string;
  let entryNo: bigint;
  try {
    const inserted = rowsOf<{ id: string; entry_no: string }>(
      await ex.execute(sql`
        INSERT INTO journal_entries
          (description_ar, source_type, source_id, kind, created_by, entry_date, is_reversal, reversal_reason)
        VALUES (
          ${draft.descriptionAr},
          ${draft.sourceType},
          ${draft.sourceId}::uuid,
          ${draft.kind},
          ${opts.actorUserId ?? null}::uuid,
          ${opts.entryDate ?? sql`now()`},
          ${draft.kind.endsWith("_reversal")},
          ${draft.kind.endsWith("_reversal") ? draft.descriptionAr : null}
        )
        RETURNING id, entry_no
      `)
    );
    if (!inserted[0]) throw new Error("مقدرناش نكتب القيد");
    entryId = inserted[0].id;
    entryNo = BigInt(inserted[0].entry_no);
  } catch (err) {
    if (isUniqueViolation(err, "je_source_kind_uq")) {
      throw new Error(
        `العملية دي اتقيّدت قبل كده (${draft.kind}) — مش هتتكرر. ` +
          `لو محتاج تصحيح، اعمل قيد عكسي.`
      );
    }
    throw err;
  }

  for (const line of draft.lines) {
    await ex.execute(sql`
      INSERT INTO journal_lines
        (entry_id, account_id, debit_p, credit_p, shipment_id, merchant_id, courier_id, memo)
      VALUES (
        ${entryId}::uuid,
        ${accountIds.get(accountKey(line.account))!}::uuid,
        ${line.debitP.toString()}::bigint,
        ${line.creditP.toString()}::bigint,
        ${line.shipmentId ?? null}::uuid,
        ${line.merchantId ?? null}::uuid,
        ${line.courierId ?? null}::uuid,
        ${line.memo ?? null}
      )
    `);
  }

  // رصيد التاجر المعروض لازم يتحدّث في **نفس** الترانزاكشن —
  // لو اتحدّث بعدين، هيبقى فيه لحظة التاجر شايف فيها رقم غلط.
  const merchants = new Set(
    draft.lines
      .map((l) => (l.account.code === "MERCHANT_PAYABLE" ? l.account.ownerId : null))
      .filter((id): id is string => !!id)
  );
  for (const merchantId of merchants) {
    await recomputeMerchantBalance(ex, merchantId);
  }

  // ⚠️ التوازن بيتفحص من قاعدة البيانات عند COMMIT
  //    (constraint trigger DEFERRABLE) — مش من هنا.
  return { entryId, entryNo };
}

// ---------------------------------------------------------------
// رصيد التاجر بخانتين
// ---------------------------------------------------------------

export interface MerchantBalance {
  /** ✅ مؤكد وجاهز للتحويل — الكاش وصل الشركة فعلًا */
  confirmedP: bigint;
  /** ⏳ تحت التحصيل — اتسلّم بس الكاش لسه مع المندوب */
  inCollectionP: bigint;
}

/**
 * إعادة احتساب رصيد التاجر من الدفتر وتخزينه.
 *
 * ⚠️ الخانتين هما أهم حاجة بيشوفها التاجر. **الرقم المؤكد
 *    عمره ما يقل** — وده الفرق بين تاجر واثق وتاجر بيتخانق.
 *
 * قاعدة التأكيد:
 *   تسليم العهدة بيصفّي عهدة المندوب بالكامل عند لحظة معيّنة.
 *   يعني أي تحصيل كاش **اتقيّد قبل آخر تسليم عهدة مؤكد
 *   للمندوب ده** يبقى فلوسه وصلت الشركة → مؤكد.
 *   واللي اتقيّد بعده لسه في جيب المندوب → تحت التحصيل.
 *
 *   والتحصيل اللي جه محفظة أو بنك **مؤكد من أول لحظة** —
 *   لأن المندوب أصلًا ملوش علاقة بيه.
 */
export async function recomputeMerchantBalance(
  ex: SqlExecutor,
  merchantId: string
): Promise<MerchantBalance> {
  const rows = rowsOf<{ total: string; in_collection: string }>(
    await ex.execute(sql`
      WITH payable AS (
        SELECT jl.entry_id,
               (jl.credit_p - jl.debit_p) AS amount_p
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE a.code = 'MERCHANT_PAYABLE' AND a.owner_id = ${merchantId}::uuid
      ),
      -- آخر لحظة اتأكد فيها استلام عهدة كل مندوب
      last_handover AS (
        SELECT a.owner_id AS courier_id, MAX(je.entry_date) AS confirmed_until
        FROM journal_entries je
        JOIN journal_lines jl ON jl.entry_id = je.id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.kind = 'handover' AND a.code = 'COURIER_CASH'
        GROUP BY a.owner_id
      ),
      -- الكاش اللي لسه مع المندوب: قيده بعد آخر تسليم عهدة
      pending AS (
        SELECT DISTINCT p.entry_id
        FROM payable p
        JOIN journal_entries je ON je.id = p.entry_id
        JOIN journal_lines cash ON cash.entry_id = p.entry_id
        JOIN accounts ca ON ca.id = cash.account_id AND ca.code = 'COURIER_CASH'
        LEFT JOIN last_handover lh ON lh.courier_id = ca.owner_id
        WHERE cash.debit_p > 0
          AND (lh.confirmed_until IS NULL OR je.entry_date > lh.confirmed_until)
      )
      SELECT COALESCE(SUM(p.amount_p), 0)::text AS total,
             COALESCE(SUM(p.amount_p) FILTER (
               WHERE p.entry_id IN (SELECT entry_id FROM pending)
             ), 0)::text AS in_collection
      FROM payable p
    `)
  );

  const total = BigInt(rows[0]?.total ?? "0");
  const inCollection = BigInt(rows[0]?.in_collection ?? "0");
  const confirmed = total - inCollection;

  await ex.execute(sql`
    INSERT INTO merchant_balances
      (merchant_id, payable_confirmed_p, payable_in_collection_p, last_recomputed_at)
    VALUES (${merchantId}::uuid, ${confirmed.toString()}::bigint,
            ${inCollection.toString()}::bigint, now())
    ON CONFLICT (merchant_id) DO UPDATE SET
      payable_confirmed_p     = EXCLUDED.payable_confirmed_p,
      payable_in_collection_p = EXCLUDED.payable_in_collection_p,
      last_recomputed_at      = now()
  `);

  return { confirmedP: confirmed, inCollectionP: inCollection };
}

/** رصيد حساب من الدفتر مباشرة — المصدر الوحيد للحقيقة */
export async function accountBalance(
  ex: SqlExecutor,
  ref: AccountRef
): Promise<bigint> {
  const accountId = await resolveAccountId(ex, ref);
  const rows = rowsOf<{ balance: string }>(
    await ex.execute(sql`
      SELECT COALESCE(SUM(debit_p) - SUM(credit_p), 0)::text AS balance
      FROM journal_lines WHERE account_id = ${accountId}::uuid
    `)
  );
  return BigInt(rows[0]?.balance ?? "0");
}

// ---------------------------------------------------------------

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint_name?: string; constraint?: string; message?: string };
  if (e.code !== "23505") return false;
  return (
    e.constraint_name === constraint ||
    e.constraint === constraint ||
    (e.message?.includes(constraint) ?? false)
  );
}
