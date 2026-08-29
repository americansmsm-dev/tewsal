/**
 * ============================================================
 *  أدوات التشغيل الداخلي — مرحلة هـ
 * ------------------------------------------------------------
 *  التاسكات + التذاكر + المصروفات (المصروف بيقيّد في الدفتر).
 *  ⚠️ المصروف عبر postEntry + buildExpenseEntry — مش قيد بإيد.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { poundsToPiastres, type Piastres } from "@/lib/money";
import { buildExpenseEntry } from "../domain/ledger";
import { postEntry, type SqlExecutor } from "./ledger";
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

// ---------------------------------------------------------------
// التاسكات
// ---------------------------------------------------------------

export async function createTask(
  ex: SqlExecutor,
  input: { title: string; body?: string | null; type?: string; priority?: string; shipmentId?: string | null; assigneeId?: string | null; dueAt?: string | null; actor: Actor }
): Promise<{ id: string; code: string }> {
  if (!input.title?.trim()) throw new HttpError(422, "TITLE_REQUIRED", "لازم عنوان");
  const code = await nextCode(ex, "TSK");
  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO tasks (code, title, body, type, priority, shipment_id, assignee_id, due_at, created_by)
      VALUES (${code}, ${input.title}, ${input.body ?? null}, ${input.type ?? "task"}, ${input.priority ?? "normal"},
              ${input.shipmentId ?? null}::uuid, ${input.assigneeId ?? null}::uuid, ${input.dueAt ?? null}, ${input.actor.userId ?? null}::uuid)
      RETURNING id::text`)
  )[0]!.id;
  return { id, code };
}

export async function listTasks(ex: SqlExecutor, input: { status?: string | null; assigneeId?: string | null } = {}) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT t.id::text, t.code, t.title, t.type, t.priority, t.status, t.due_at, t.created_at,
             u.full_name AS assignee_name, s.awb,
             (t.due_at IS NOT NULL AND t.due_at < now() AND t.status NOT IN ('done','cancelled')) AS overdue
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN shipments s ON s.id = t.shipment_id
      WHERE 1=1 ${input.status ? sql`AND t.status = ${input.status}` : sql``}
        ${input.assigneeId ? sql`AND t.assignee_id = ${input.assigneeId}::uuid` : sql``}
      ORDER BY (t.status = 'done') ASC,
        CASE t.priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC
      LIMIT 300`)
  );
}

export async function updateTask(
  ex: SqlExecutor,
  input: { taskId: string; status?: string; assigneeId?: string | null }
): Promise<{ updated: boolean }> {
  if (input.status && !["open", "in_progress", "done", "cancelled"].includes(input.status)) {
    throw new HttpError(400, "BAD_STATUS", "حالة غير صالحة");
  }
  await ex.execute(sql`
    UPDATE tasks SET
      status = ${input.status ?? sql`status`},
      assignee_id = ${input.assigneeId !== undefined ? sql`${input.assigneeId}::uuid` : sql`assignee_id`},
      done_at = ${input.status === "done" ? sql`now()` : sql`done_at`},
      updated_at = now()
    WHERE id = ${input.taskId}::uuid`);
  return { updated: true };
}

// ---------------------------------------------------------------
// التذاكر
// ---------------------------------------------------------------

export async function createTicket(
  ex: SqlExecutor,
  input: { category?: string; subject: string; priority?: string; merchantId?: string | null; shipmentId?: string | null; customerPhone?: string | null; body?: string | null; actor: Actor }
): Promise<{ id: string; code: string }> {
  if (!input.subject?.trim()) throw new HttpError(422, "SUBJECT_REQUIRED", "لازم موضوع");
  const code = await nextCode(ex, "TCK");
  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO tickets (code, category, subject, priority, merchant_id, shipment_id, customer_phone, created_by)
      VALUES (${code}, ${input.category ?? "inquiry"}, ${input.subject}, ${input.priority ?? "normal"},
              ${input.merchantId ?? null}::uuid, ${input.shipmentId ?? null}::uuid, ${input.customerPhone ?? null}, ${input.actor.userId ?? null}::uuid)
      RETURNING id::text`)
  )[0]!.id;
  if (input.body?.trim()) {
    await ex.execute(sql`INSERT INTO ticket_messages (ticket_id, user_id, body) VALUES (${id}::uuid, ${input.actor.userId ?? null}::uuid, ${input.body})`);
  }
  return { id, code };
}

export async function listTickets(ex: SqlExecutor, input: { status?: string | null } = {}) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT t.id::text, t.code, t.category, t.subject, t.priority, t.status, t.customer_phone, t.created_at,
             m.name_ar AS merchant_name, s.awb, u.full_name AS assigned_name
      FROM tickets t
      LEFT JOIN merchants m ON m.id = t.merchant_id
      LEFT JOIN shipments s ON s.id = t.shipment_id
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE 1=1 ${input.status ? sql`AND t.status = ${input.status}` : sql``}
      ORDER BY (t.status IN ('resolved','closed')) ASC,
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, t.created_at DESC
      LIMIT 300`)
  );
}

export async function ticketThread(ex: SqlExecutor, ticketId: string) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT m.body, m.is_internal, m.created_at, u.full_name AS by_name
      FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.ticket_id = ${ticketId}::uuid ORDER BY m.created_at`)
  );
}

export async function addTicketMessage(ex: SqlExecutor, input: { ticketId: string; body: string; isInternal?: boolean; actor: Actor }): Promise<{ added: boolean }> {
  if (!input.body?.trim()) throw new HttpError(422, "BODY_REQUIRED", "الرسالة فاضية");
  await ex.execute(sql`INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal) VALUES (${input.ticketId}::uuid, ${input.actor.userId ?? null}::uuid, ${input.body}, ${input.isInternal ?? true})`);
  await ex.execute(sql`UPDATE tickets SET updated_at = now() WHERE id = ${input.ticketId}::uuid`);
  return { added: true };
}

export async function updateTicket(ex: SqlExecutor, input: { ticketId: string; status?: string; assignedTo?: string | null; priority?: string }): Promise<{ updated: boolean }> {
  if (input.status && !["open", "pending", "resolved", "closed"].includes(input.status)) throw new HttpError(400, "BAD_STATUS", "حالة غير صالحة");
  await ex.execute(sql`
    UPDATE tickets SET
      status = ${input.status ?? sql`status`},
      priority = ${input.priority ?? sql`priority`},
      assigned_to = ${input.assignedTo !== undefined ? sql`${input.assignedTo}::uuid` : sql`assigned_to`},
      resolved_at = ${input.status === "resolved" || input.status === "closed" ? sql`COALESCE(resolved_at, now())` : sql`resolved_at`},
      updated_at = now()
    WHERE id = ${input.ticketId}::uuid`);
  return { updated: true };
}

// ---------------------------------------------------------------
// المصروفات
// ---------------------------------------------------------------

export async function listExpenseCategories(ex: SqlExecutor) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`SELECT id::text, code, name_ar, account_code FROM expense_categories WHERE is_active = true ORDER BY name_ar`)
  );
}

export async function recordExpense(
  ex: SqlExecutor,
  input: { categoryId: string; amount: string; description: string; paidFrom?: "branch_cash" | "bank"; vehicleRef?: string | null; branchId?: string | null; actor: Actor }
): Promise<{ id: string; code: string; amountP: Piastres }> {
  const amountP = poundsToPiastres(input.amount);
  if (amountP <= 0n) throw new HttpError(400, "BAD_AMOUNT", "المبلغ لازم أكبر من صفر");
  if (!input.description?.trim()) throw new HttpError(422, "DESC_REQUIRED", "لازم وصف");

  const cat = rowsOf<{ account_code: string }>(
    await ex.execute(sql`SELECT account_code FROM expense_categories WHERE id = ${input.categoryId}::uuid AND is_active = true LIMIT 1`)
  )[0];
  if (!cat) throw new HttpError(422, "CAT_MISSING", "بند المصروف مش موجود");

  const branchId = input.branchId
    ?? rowsOf<{ id: string }>(await ex.execute(sql`SELECT id::text FROM branches WHERE code = 'MAIN' LIMIT 1`))[0]?.id;
  if (!branchId) throw new HttpError(422, "NO_BRANCH", "مفيش فرع");
  const paidFrom = input.paidFrom ?? "branch_cash";
  const code = await nextCode(ex, "EXP");

  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO expenses (code, category_id, amount_p, description_ar, branch_id, vehicle_ref, paid_from, created_by)
      VALUES (${code}, ${input.categoryId}::uuid, ${amountP.toString()}::bigint, ${input.description},
              ${branchId}::uuid, ${input.vehicleRef ?? null}, ${paidFrom}, ${input.actor.userId ?? null}::uuid)
      RETURNING id::text`)
  )[0]!.id;

  const posted = await postEntry(
    ex,
    buildExpenseEntry({ expenseId: id, code, expenseAccountCode: cat.account_code, amountP, paidFrom, branchId }),
    { actorUserId: input.actor.userId }
  );
  await ex.execute(sql`UPDATE expenses SET journal_entry_id = ${posted.entryId}::uuid WHERE id = ${id}::uuid`);
  return { id, code, amountP };
}

export async function listExpenses(ex: SqlExecutor) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT e.id::text, e.code, e.amount_p::text AS amount_p, e.description_ar, e.paid_from, e.vehicle_ref, e.created_at,
             c.name_ar AS category, u.full_name AS by_name
      FROM expenses e JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN users u ON u.id = e.created_by
      ORDER BY e.created_at DESC LIMIT 200`)
  );
}
