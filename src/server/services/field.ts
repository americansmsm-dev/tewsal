/**
 * ============================================================
 *  الميدان — مواقع وحضور المناديب + الخريطة الحية (مرحلة ي)
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}
function cairoDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// ---------------------------------------------------------------
// ساعات العمل (يحددها المدير) — تتبّع المندوب في نطاقها
// ---------------------------------------------------------------

export interface WorkHours { start: string | null; end: string | null; autoCheckout: boolean }

export async function getWorkHours(ex: SqlExecutor): Promise<WorkHours> {
  const rows = rowsOf<{ key: string; value: unknown }>(
    await ex.execute(sql`SELECT key, value FROM settings WHERE key IN ('attendance.work_start','attendance.work_end','attendance.auto_checkout')`)
  );
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const s = m.get("attendance.work_start");
  const e = m.get("attendance.work_end");
  const a = m.get("attendance.auto_checkout");
  return {
    start: typeof s === "string" && s ? s : null,
    end: typeof e === "string" && e ? e : null,
    autoCheckout: a === true || a === "true",
  };
}

function isHHMM(v: string): boolean { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }

export async function setWorkHours(ex: SqlExecutor, i: { start?: string | null; end?: string | null; autoCheckout?: boolean }): Promise<WorkHours> {
  async function put(key: string, nameAr: string, valueType: string, jsonb: string) {
    await ex.execute(sql`
      INSERT INTO settings (key, value, name_ar, category, value_type)
      VALUES (${key}, ${sql.raw(jsonb)}, ${nameAr}, 'attendance', ${valueType})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  }
  if (i.start !== undefined) {
    if (i.start && !isHHMM(i.start)) throw new HttpError(400, "BAD_TIME", "وقت البداية لازم بصيغة HH:MM");
    await put("attendance.work_start", "بداية ساعات العمل", "string", i.start ? `'"${i.start}"'::jsonb` : "'null'::jsonb");
  }
  if (i.end !== undefined) {
    if (i.end && !isHHMM(i.end)) throw new HttpError(400, "BAD_TIME", "وقت النهاية لازم بصيغة HH:MM");
    await put("attendance.work_end", "نهاية ساعات العمل", "string", i.end ? `'"${i.end}"'::jsonb` : "'null'::jsonb");
  }
  if (i.autoCheckout !== undefined) {
    await put("attendance.auto_checkout", "انصراف تلقائي بنهاية الدوام", "boolean", i.autoCheckout ? "'true'::jsonb" : "'false'::jsonb");
  }
  return getWorkHours(ex);
}

export async function recordLocation(ex: SqlExecutor, input: { courierId: string; lat: number; lng: number }): Promise<{ ok: boolean }> {
  if (Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) throw new HttpError(400, "BAD_COORDS", "إحداثيات غير صالحة");
  await ex.execute(sql`INSERT INTO courier_locations (courier_id, lat, lng) VALUES (${input.courierId}::uuid, ${input.lat}, ${input.lng})`);
  return { ok: true };
}

export async function attendance(ex: SqlExecutor, input: { courierId: string; action: "check_in" | "check_out" }): Promise<{ status: string }> {
  const day = cairoDay();
  if (input.action === "check_in") {
    await ex.execute(sql`
      INSERT INTO courier_attendance (courier_id, day, check_in_at) VALUES (${input.courierId}::uuid, ${day}, now())
      ON CONFLICT (courier_id, day) DO UPDATE SET check_in_at = COALESCE(courier_attendance.check_in_at, now())`);
    return { status: "checked_in" };
  }
  await ex.execute(sql`
    INSERT INTO courier_attendance (courier_id, day, check_out_at) VALUES (${input.courierId}::uuid, ${day}, now())
    ON CONFLICT (courier_id, day) DO UPDATE SET check_out_at = now()`);
  return { status: "checked_out" };
}

export async function myAttendance(ex: SqlExecutor, courierId: string): Promise<{ checkedIn: boolean; checkedOut: boolean }> {
  const r = rowsOf<{ ci: string | null; co: string | null }>(
    await ex.execute(sql`SELECT check_in_at AS ci, check_out_at AS co FROM courier_attendance WHERE courier_id=${courierId}::uuid AND day=${cairoDay()} LIMIT 1`)
  )[0];
  return { checkedIn: !!r?.ci && !r?.co, checkedOut: !!r?.co };
}

/** الخريطة الحية — كل مندوب نشط بآخر موقع + الحضور + عدد شحنات العهدة. */
export async function liveCouriers(ex: SqlExecutor) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT u.id::text, u.full_name,
             loc.lat, loc.lng, loc.recorded_at,
             (att.check_in_at IS NOT NULL AND att.check_out_at IS NULL) AS on_shift,
             (SELECT COUNT(*) FROM shipments s WHERE s.current_courier_id=u.id AND s.status='out_for_delivery')::int AS in_hand
      FROM users u
      LEFT JOIN LATERAL (
        SELECT lat, lng, recorded_at FROM courier_locations cl WHERE cl.courier_id=u.id ORDER BY recorded_at DESC LIMIT 1
      ) loc ON true
      LEFT JOIN courier_attendance att ON att.courier_id=u.id AND att.day=${cairoDay()}
      WHERE u.role='courier' AND u.is_active=true
      ORDER BY on_shift DESC NULLS LAST, u.full_name`)
  );
}
