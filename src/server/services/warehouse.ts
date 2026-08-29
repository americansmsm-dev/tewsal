/**
 * ============================================================
 *  المخزن وتعدد الفروع — مرحلة و
 * ------------------------------------------------------------
 *  الجرد: بيفتح جلسة، بيمسح البواليص، بيقفل ويكشف الفروقات.
 *  التحويلات: شيت سفر بيحوّل شحنات بين الفروع (بيغيّر branch_id
 *  عند الاستلام — الحالة تفضل at_hub، مش تحول حالة).
 *  الفروع: إضافة فرع جديد بخزنته.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { type SqlExecutor } from "./ledger";
import { type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}
async function nextCode(ex: SqlExecutor, prefix: string): Promise<string> {
  const n = rowsOf<{ n: string }>(await ex.execute(sql`SELECT nextval('awb_sequence')::text AS n`))[0]!.n;
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `${prefix}-${year}-${n.padStart(6, "0")}`;
}
async function mainBranch(ex: SqlExecutor): Promise<string> {
  const id = rowsOf<{ id: string }>(await ex.execute(sql`SELECT id::text FROM branches WHERE code='MAIN' LIMIT 1`))[0]?.id;
  if (!id) throw new HttpError(422, "NO_BRANCH", "مفيش فرع");
  return id;
}

// ---------------------------------------------------------------
// الجرد
// ---------------------------------------------------------------

export async function createCount(ex: SqlExecutor, input: { branchId?: string | null; actor: Actor }): Promise<{ id: string; code: string; expected: number }> {
  const branchId = input.branchId ?? (await mainBranch(ex));
  const expected = rowsOf<{ n: number }>(
    await ex.execute(sql`SELECT COUNT(*)::int AS n FROM shipments WHERE status='at_hub' AND branch_id=${branchId}::uuid`)
  )[0]!.n;
  const code = await nextCode(ex, "INV");
  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO inventory_counts (code, branch_id, expected_count, created_by)
      VALUES (${code}, ${branchId}::uuid, ${expected}, ${input.actor.userId ?? null}::uuid)
      RETURNING id::text`)
  )[0]!.id;
  return { id, code, expected };
}

export async function scanCount(ex: SqlExecutor, input: { countId: string; awb: string }): Promise<{ result: string; already: boolean; recipient?: string }> {
  const cnt = rowsOf<{ status: string; branch_id: string }>(
    await ex.execute(sql`SELECT status, branch_id::text FROM inventory_counts WHERE id=${input.countId}::uuid LIMIT 1`)
  )[0];
  if (!cnt) throw new HttpError(404, "NOT_FOUND", "الجرد مش موجود");
  if (cnt.status !== "open") throw new HttpError(422, "CLOSED", "الجرد مقفول");

  const ship = rowsOf<{ id: string; status: string; branch_id: string | null; recipient_name: string }>(
    await ex.execute(sql`SELECT id::text, status, branch_id::text, recipient_name FROM shipments WHERE awb=${input.awb} LIMIT 1`)
  )[0];
  const matched = !!ship && ship.status === "at_hub" && ship.branch_id === cnt.branch_id;
  const result = matched ? "matched" : "unexpected";

  const ins = await ex.execute(sql`
    INSERT INTO inventory_count_scans (count_id, awb, shipment_id, result)
    VALUES (${input.countId}::uuid, ${input.awb}, ${ship?.id ?? null}::uuid, ${result})
    ON CONFLICT (count_id, awb) DO NOTHING`);
  const already = (ins as { count?: number })?.count === 0;
  return { result, already, recipient: ship?.recipient_name };
}

export async function closeCount(ex: SqlExecutor, input: { countId: string }): Promise<{ expected: number; counted: number; missing: number; unexpected: number; missingAwbs: string[] }> {
  const cnt = rowsOf<{ status: string; branch_id: string; expected_count: number }>(
    await ex.execute(sql`SELECT status, branch_id::text, expected_count FROM inventory_counts WHERE id=${input.countId}::uuid FOR UPDATE`)
  )[0];
  if (!cnt) throw new HttpError(404, "NOT_FOUND", "الجرد مش موجود");
  if (cnt.status !== "open") throw new HttpError(422, "CLOSED", "الجرد مقفول بالفعل");

  const counted = rowsOf<{ n: number }>(await ex.execute(sql`SELECT COUNT(*)::int AS n FROM inventory_count_scans WHERE count_id=${input.countId}::uuid AND result='matched'`))[0]!.n;
  const unexpected = rowsOf<{ n: number }>(await ex.execute(sql`SELECT COUNT(*)::int AS n FROM inventory_count_scans WHERE count_id=${input.countId}::uuid AND result='unexpected'`))[0]!.n;

  // الناقص: شحنات at_hub في الفرع مش موجودة في المسح
  const missingRows = rowsOf<{ awb: string }>(
    await ex.execute(sql`
      SELECT s.awb FROM shipments s
      WHERE s.status='at_hub' AND s.branch_id=${cnt.branch_id}::uuid
        AND NOT EXISTS (SELECT 1 FROM inventory_count_scans sc WHERE sc.count_id=${input.countId}::uuid AND sc.awb=s.awb)
      ORDER BY s.awb LIMIT 500`)
  );
  const missing = missingRows.length;

  await ex.execute(sql`
    UPDATE inventory_counts SET status='closed', counted_count=${counted}, missing_count=${missing},
      unexpected_count=${unexpected}, closed_at=now() WHERE id=${input.countId}::uuid`);
  return { expected: cnt.expected_count, counted, missing, unexpected, missingAwbs: missingRows.map((r) => r.awb) };
}

export async function listCounts(ex: SqlExecutor) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT c.id::text, c.code, c.status, c.expected_count, c.counted_count, c.missing_count, c.unexpected_count, c.created_at, b.name_ar AS branch
      FROM inventory_counts c LEFT JOIN branches b ON b.id=c.branch_id
      ORDER BY c.created_at DESC LIMIT 100`)
  );
}

// ---------------------------------------------------------------
// شيتات السفر (التحويل بين الفروع)
// ---------------------------------------------------------------

export async function createTransfer(ex: SqlExecutor, input: { fromBranchId?: string | null; toBranchId: string; actor: Actor }): Promise<{ id: string; code: string }> {
  const fromBranchId = input.fromBranchId ?? (await mainBranch(ex));
  if (fromBranchId === input.toBranchId) throw new HttpError(422, "SAME_BRANCH", "الفرع المرسِل والمستقبل واحد");
  const code = await nextCode(ex, "TRF");
  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO transfer_sheets (code, from_branch_id, to_branch_id, created_by)
      VALUES (${code}, ${fromBranchId}::uuid, ${input.toBranchId}::uuid, ${input.actor.userId ?? null}::uuid)
      RETURNING id::text`)
  )[0]!.id;
  return { id, code };
}

export async function addToTransfer(ex: SqlExecutor, input: { transferId: string; shipmentIds: string[] }): Promise<{ added: number }> {
  const ts = rowsOf<{ status: string; from_branch_id: string }>(
    await ex.execute(sql`SELECT status, from_branch_id::text FROM transfer_sheets WHERE id=${input.transferId}::uuid FOR UPDATE`)
  )[0];
  if (!ts) throw new HttpError(404, "NOT_FOUND", "الشيت مش موجود");
  if (ts.status !== "open") throw new HttpError(422, "BAD_STATUS", "الشيت مش مفتوح");

  let added = 0;
  for (const sid of input.shipmentIds) {
    const s = rowsOf<{ status: string; branch_id: string | null }>(
      await ex.execute(sql`SELECT status, branch_id::text FROM shipments WHERE id=${sid}::uuid`)
    )[0];
    if (!s || s.status !== "at_hub") throw new HttpError(422, "NOT_AT_HUB", "فيه شحنة مش في المخزن");
    const ins = await ex.execute(sql`INSERT INTO transfer_sheet_items (transfer_sheet_id, shipment_id) VALUES (${input.transferId}::uuid, ${sid}::uuid) ON CONFLICT DO NOTHING`);
    if ((ins as { count?: number })?.count !== 0) added++;
  }
  const total = rowsOf<{ n: number }>(await ex.execute(sql`SELECT COUNT(*)::int AS n FROM transfer_sheet_items WHERE transfer_sheet_id=${input.transferId}::uuid`))[0]!.n;
  await ex.execute(sql`UPDATE transfer_sheets SET shipments_count=${total} WHERE id=${input.transferId}::uuid`);
  return { added };
}

export async function transferAction(ex: SqlExecutor, input: { transferId: string; action: "dispatch" | "receive" | "cancel" }): Promise<{ status: string; moved?: number }> {
  const ts = rowsOf<{ status: string; to_branch_id: string }>(
    await ex.execute(sql`SELECT status, to_branch_id::text FROM transfer_sheets WHERE id=${input.transferId}::uuid FOR UPDATE`)
  )[0];
  if (!ts) throw new HttpError(404, "NOT_FOUND", "الشيت مش موجود");

  if (input.action === "cancel") {
    if (ts.status === "received") throw new HttpError(422, "RECEIVED", "الشيت اتستلم — مينفعش يتلغي");
    await ex.execute(sql`UPDATE transfer_sheets SET status='cancelled' WHERE id=${input.transferId}::uuid`);
    return { status: "cancelled" };
  }
  if (input.action === "dispatch") {
    if (ts.status !== "open") throw new HttpError(422, "BAD_STATUS", "لازم يكون مفتوح");
    await ex.execute(sql`UPDATE transfer_sheets SET status='dispatched', dispatched_at=now() WHERE id=${input.transferId}::uuid`);
    return { status: "dispatched" };
  }
  // receive: نقل branch_id لكل الشحنات للفرع المستقبل (الحالة تفضل at_hub)
  if (ts.status !== "dispatched") throw new HttpError(422, "BAD_STATUS", "لازم يكون منزّل (dispatched) الأول");
  const moved = rowsOf<{ n: number }>(
    await ex.execute(sql`
      UPDATE shipments SET branch_id=${ts.to_branch_id}::uuid, updated_at=now()
      WHERE id IN (SELECT shipment_id FROM transfer_sheet_items WHERE transfer_sheet_id=${input.transferId}::uuid)
      RETURNING 1`)
  ).length;
  await ex.execute(sql`UPDATE transfer_sheets SET status='received', received_at=now() WHERE id=${input.transferId}::uuid`);
  return { status: "received", moved };
}

export async function listTransfers(ex: SqlExecutor) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT t.id::text, t.code, t.status, t.shipments_count, t.created_at,
             f.name_ar AS from_branch, b.name_ar AS to_branch
      FROM transfer_sheets t LEFT JOIN branches f ON f.id=t.from_branch_id JOIN branches b ON b.id=t.to_branch_id
      ORDER BY t.created_at DESC LIMIT 100`)
  );
}

// ---------------------------------------------------------------
// الفروع
// ---------------------------------------------------------------

export async function listBranches(ex: SqlExecutor) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT b.id::text, b.code, b.name_ar, b.phone,
             COALESCE(SUM(jl.debit_p - jl.credit_p),0)::text AS cash_p,
             (SELECT COUNT(*) FROM shipments s WHERE s.branch_id=b.id AND s.status='at_hub')::int AS at_hub
      FROM branches b
      LEFT JOIN accounts a ON a.owner_id=b.id AND a.code='BRANCH_CASH'
      LEFT JOIN journal_lines jl ON jl.account_id=a.id
      GROUP BY b.id ORDER BY b.code`)
  );
}

export async function createBranch(ex: SqlExecutor, input: { code: string; nameAr: string; governorateId?: string | null; phone?: string | null }): Promise<{ id: string }> {
  const gov = input.governorateId ?? rowsOf<{ id: string }>(await ex.execute(sql`SELECT id::text FROM governorates WHERE code='CAI' LIMIT 1`))[0]?.id;
  try {
    const id = rowsOf<{ id: string }>(
      await ex.execute(sql`
        INSERT INTO branches (code, name_ar, governorate_id, phone)
        VALUES (${input.code}, ${input.nameAr}, ${gov ?? null}::uuid, ${input.phone ?? null})
        RETURNING id::text`)
    )[0]!.id;
    // خزنة الفرع الجديد
    await ex.execute(sql`
      INSERT INTO accounts (code, name_ar, type, owner_type, owner_id, is_template)
      VALUES ('BRANCH_CASH', ${`خزنة ${input.nameAr}`}, 'asset', 'branch', ${id}::uuid, false)
      ON CONFLICT (code, owner_id) DO NOTHING`);
    return { id };
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") throw new HttpError(422, "CODE_EXISTS", "كود الفرع موجود");
    throw err;
  }
}
