/**
 * ============================================================
 *  applyTransition — البوابة الوحيدة لتغيير حالة الشحنة
 * ------------------------------------------------------------
 *  ⚠️ دي **الدالة الوحيدة في السيستم كله** اللي تقدر تغيّر
 *     حالة شحنة. أي مسار كتابة (API، PWA، استيراد، مهمة
 *     خلفية) لازم يعدّي من هنا. مفيش UPDATE على shipments.status
 *     في أي مكان تاني.
 *
 *  كل نداء بيحصل **جوه ترانزاكشن واحدة**، وبالترتيب ده:
 *    ١) SELECT ... FOR UPDATE  — قفل الصف
 *    ٢) فحص التزامن (الحالة/النسخة/المندوب المتوقعين)
 *    ٣) فحص إيدمبوتنسي (نفس الحدث من الـ PWA؟)
 *    ٤) canTransition()        — قواعد آلة الحالات
 *    ٥) سطر تاريخ (إضافة فقط)
 *    ٦) قيد مالي لو التحول مالي — نفس الترانزاكشن
 *    ٧) تحديث الشحنة + version++
 *    ٨) سطر تدقيق
 *
 *  لو أي خطوة فشلت، الترانزاكشن كلها بترجع — مفيش نص عملية.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import {
  canTransition,
  isFinancialTransition,
  STATUS_LABELS_AR,
  type ShipmentStatus,
  type Role,
  type TransitionRequirement,
} from "../domain/statusMachine";
import { computePromisedAt, type SlaConfig, type WorkingTimeConfig } from "../domain/workingTime";
import type { DraftEntry } from "../domain/ledger";
import { postEntry, type SqlExecutor } from "./ledger";

// ---------------------------------------------------------------
// الأخطاء — كل خطأ له كود عشان طبقة الـ API تترجمه لـ HTTP
// ---------------------------------------------------------------

export type TransitionErrorCode =
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "STATUS_CONFLICT"
  | "REASSIGNED"
  | "AMOUNT_MISMATCH"
  | "NOT_ALLOWED"
  | "FINANCIAL_REQUIRED"
  | "FINANCIAL_UNEXPECTED"
  | "BAD_INPUT";

export class TransitionError extends Error {
  constructor(
    public readonly code: TransitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

// ---------------------------------------------------------------
// المدخلات
// ---------------------------------------------------------------

export interface Actor {
  userId: string | null;
  role: Role;
  name: string;
}

export interface TransitionInput {
  shipmentId: string;
  to: ShipmentStatus;
  actor: Actor;

  // --- التزامن (اختياري لكن مهم من الـ PWA) ---
  /** لو الحالة الحالية مش دي → تعارض */
  expectedStatus?: ShipmentStatus;
  /** قفل تفاؤلي — لو النسخة اتغيّرت → تعارض */
  expectedVersion?: number;
  /** لو الشحنة اتحوّلت لمندوب تاني → REASSIGNED */
  expectedCourierId?: string | null;

  // --- إيدمبوتنسي الـ PWA ---
  /** uuidv7 من جهاز المندوب — بيمنع تكرار الحدث عند إعادة المزامنة */
  deviceEventId?: string | null;
  /** ساعة الجهاز — للعرض بس. المالية بتقرا ساعة السيرفر */
  occurredAt?: Date;
  wasOffline?: boolean;
  source?: string;
  lat?: number | null;
  lng?: number | null;

  // --- المتطلبات المصاحبة ---
  reasonCode?: string;
  note?: string;
  receiverName?: string;
  photoUrl?: string;
  signatureUrl?: string;
  opsPreauthByUserId?: string | null;

  // --- التحصيل (للتسليم) ---
  cod?: { collectedP: bigint; method: string };

  // --- التشغيل ---
  /** بيتحط على الشحنة عند الإسناد/التحميل */
  courierId?: string | null;
  runSheetId?: string | null;
  pickupId?: string | null;

  /**
   * دالة بناء القيد المالي — بتتنده **بعد** ما البوابة تتأكد
   * إن التحول مسموح (canTransition)، مش قبل. ده مهم عشان
   * تحول ممنوع يرجّع NOT_ALLOWED مش خطأ بناء القيد.
   *
   * ⚠️ الطبقة اللي فوق بتبنيه لأنها عندها بيانات التسعير،
   *    وبيتكتب هنا **جوه نفس الترانزاكشن** بتاعة تغيير الحالة.
   *    بترجّع null لو التحول مش محتاج قيد دلوقتي.
   */
  buildFinancialEntry?: (ex: SqlExecutor) => Promise<DraftEntry | null>;

  // --- سياق التدقيق ---
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface TransitionResult {
  shipmentId: string;
  awb: string;
  fromStatus: ShipmentStatus;
  toStatus: ShipmentStatus;
  version: number;
  historyId: string;
  /** رقم القيد المالي لو اتكتب */
  journalEntryNo: bigint | null;
  /** true لو ده كان تكرار من الـ PWA واترد بصمت */
  idempotentReplay: boolean;
  promisedAt: Date | null;
}

// ---------------------------------------------------------------

interface ShipmentRow {
  id: string;
  awb: string;
  merchant_id: string;
  status: ShipmentStatus;
  version: number;
  current_courier_id: string | null;
  attempts_count: number;
  promised_at: string | null;
  status_before_hold: string | null;
  zone_id: string;
  governorate_id: string;
  cod_amount_p: string;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/** استنتاج المتطلبات المتوفرة من المدخلات — عشان canTransition */
function providedRequirements(i: TransitionInput): TransitionRequirement[] {
  const p: TransitionRequirement[] = [];
  if (i.cod) p.push("cod_amount");
  if (i.reasonCode) p.push("reason_code");
  if (i.photoUrl) p.push("photo");
  if (i.signatureUrl) p.push("signature");
  if (i.receiverName) p.push("receiver_name");
  if (i.note) p.push("note");
  if (i.pickupId) p.push("pickup");
  if (i.runSheetId) p.push("run_sheet");
  if (i.opsPreauthByUserId) p.push("ops_preauth");
  return p;
}

// ---------------------------------------------------------------
// الدالة
// ---------------------------------------------------------------

export async function applyTransition(
  ex: SqlExecutor,
  input: TransitionInput
): Promise<TransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();

  // ═══ ١) قفل الصف ═══
  const shipments = rowsOf<ShipmentRow>(
    await ex.execute(sql`
      SELECT id, awb, merchant_id, status, version, current_courier_id,
             attempts_count, promised_at::text, status_before_hold,
             zone_id, governorate_id, cod_amount_p::text
      FROM shipments
      WHERE id = ${input.shipmentId}::uuid
      FOR UPDATE
    `)
  );
  const ship = shipments[0];
  if (!ship) {
    throw new TransitionError("NOT_FOUND", "الشحنة مش موجودة");
  }
  const fromStatus = ship.status;

  // ═══ ٣) إيدمبوتنسي — نفس الحدث من الـ PWA؟ ═══
  // بنفحص ده **قبل** فحوصات التزامن، لأن إعادة المزامنة
  // بتيجي بعد ما الحالة اتغيّرت فعلًا — والرد الصح هو ack صامت.
  if (input.deviceEventId) {
    const prior = rowsOf<{ id: string; to_status: string; cod_collected_p: string | null }>(
      await ex.execute(sql`
        SELECT h.id, h.to_status,
               (SELECT s.cod_collected_p::text FROM shipments s WHERE s.id = h.shipment_id) AS cod_collected_p
        FROM shipment_status_history h
        WHERE h.shipment_id = ${input.shipmentId}::uuid
          AND h.device_event_id = ${input.deviceEventId}::uuid
        LIMIT 1
      `)
    );
    if (prior[0]) {
      // نفس الحدث اتسجّل قبل كده
      if (prior[0].to_status !== input.to) {
        throw new TransitionError(
          "AMOUNT_MISMATCH",
          "الحدث ده اتسجّل قبل كده بنتيجة مختلفة — راجع الحالة"
        );
      }
      // ⚠️ مبلغ مختلف بنفس الحدث = بالظبط إزاي الكاش بيضيع
      if (input.cod && prior[0].cod_collected_p !== null) {
        if (BigInt(prior[0].cod_collected_p) !== input.cod.collectedP) {
          throw new TransitionError(
            "AMOUNT_MISMATCH",
            "نفس الحدث بمبلغ مختلف — لازم تعيد اختيار نتيجة التسليم"
          );
        }
      }
      // تكرار مطابق → ack صامت
      return {
        shipmentId: ship.id,
        awb: ship.awb,
        fromStatus,
        toStatus: input.to,
        version: ship.version,
        historyId: prior[0].id,
        journalEntryNo: null,
        idempotentReplay: true,
        promisedAt: ship.promised_at ? new Date(ship.promised_at) : null,
      };
    }
  }

  // ═══ ٢) فحص التزامن ═══
  if (input.expectedVersion !== undefined && ship.version !== input.expectedVersion) {
    throw new TransitionError(
      "VERSION_CONFLICT",
      "الشحنة اتعدّلت من مكان تاني — حدّث وحاول تاني"
    );
  }
  if (input.expectedStatus !== undefined && fromStatus !== input.expectedStatus) {
    throw new TransitionError(
      "STATUS_CONFLICT",
      `الشحنة بقت "${STATUS_LABELS_AR[fromStatus]}" مش "${STATUS_LABELS_AR[input.expectedStatus]}"`
    );
  }
  if (
    input.expectedCourierId !== undefined &&
    (ship.current_courier_id ?? null) !== (input.expectedCourierId ?? null)
  ) {
    throw new TransitionError(
      "REASSIGNED",
      "الشحنة اتحوّلت لمندوب تاني — اتشالت من مهامك"
    );
  }

  // ═══ ٤) قواعد آلة الحالات ═══
  const check = canTransition(fromStatus, input.to, input.actor.role, providedRequirements(input));
  if (!check.ok || !check.transition) {
    throw new TransitionError("NOT_ALLOWED", check.error ?? "تحول غير مسموح");
  }

  // ═══ بناء القيد المالي — بعد التأكد إن التحول مسموح ═══
  const financial = isFinancialTransition(fromStatus, input.to);
  // ⚠️ الفقد والتلف ماليّان بس مبيقيّدوش دلوقتي — بيفتحوا مطالبة
  //    والتعويض بيتقيّد وقت اعتماد المطالبة، مش وقت التحول.
  const opensClaimOnly = input.to === "lost" || input.to === "damaged";
  const postsNow = financial && !opensClaimOnly;

  // ⚠️ الترتيب مهم: بنبني القيد **بعد** canTransition. لو التحول
  //    ممنوع، بيرجع NOT_ALLOWED قبل ما نلمس أي منطق مالي.
  let draftEntry: DraftEntry | null = null;
  if (postsNow) {
    if (!input.buildFinancialEntry) {
      throw new TransitionError(
        "FINANCIAL_REQUIRED",
        `التحول لـ "${STATUS_LABELS_AR[input.to]}" بيعمل قيد مالي — لازم يتبعت معاه`
      );
    }
    // بترجّع null لو الطبقة الأعلى قرّرت إن مفيش قيد (مثلًا
    // إلغاء والشحن مش بيتحاسب) — ده مسموح.
    draftEntry = await input.buildFinancialEntry(ex);
  }

  // القيد لازم يخص نفس الشحنة — حماية من خطأ الطبقة الأعلى
  if (
    draftEntry &&
    draftEntry.sourceType === "shipment" &&
    draftEntry.sourceId !== input.shipmentId
  ) {
    throw new TransitionError("BAD_INPUT", "القيد المالي بيخص شحنة تانية — رفضناه");
  }

  // ═══ ٥) سطر التاريخ (إضافة فقط) ═══
  let historyId: string;
  try {
    const hist = rowsOf<{ id: string }>(
      await ex.execute(sql`
        INSERT INTO shipment_status_history
          (shipment_id, from_status, to_status, reason_code, note,
           actor_user_id, actor_role, actor_name,
           occurred_at, recorded_at, source, device_event_id, lat, lng, was_offline)
        VALUES (
          ${input.shipmentId}::uuid, ${fromStatus}, ${input.to},
          ${input.reasonCode ?? null}, ${input.note ?? null},
          ${input.actor.userId ?? null}::uuid, ${input.actor.role}, ${input.actor.name},
          ${occurredAt.toISOString()}, now(), ${input.source ?? "web"},
          ${input.deviceEventId ?? null}::uuid, ${input.lat ?? null}, ${input.lng ?? null},
          ${input.wasOffline ?? false}
        )
        RETURNING id
      `)
    );
    historyId = hist[0]!.id;
  } catch (err) {
    // سباق: حدثين بنفس device_event_id في نفس اللحظة
    if (isUniqueViolation(err, "ssh_device_event_uq")) {
      throw new TransitionError(
        "STATUS_CONFLICT",
        "الحدث ده بيتسجّل دلوقتي — حاول تاني"
      );
    }
    throw err;
  }

  // ═══ ٦) القيد المالي — نفس الترانزاكشن ═══
  let journalEntryNo: bigint | null = null;
  if (draftEntry) {
    const posted = await postEntry(ex, draftEntry, {
      actorUserId: input.actor.userId,
      // ⚠️ المالية بتقرا ساعة السيرفر — مش ساعة الجهاز
    });
    journalEntryNo = posted.entryNo;
    // رصيد التاجر بيتحدّث جوه postEntry في نفس الترانزاكشن
  }

  // ═══ ٧) تحديث الشحنة + version++ ═══
  const promisedAt = await computeNextPromisedAt(ex, input.to, ship);
  const attemptsInc = await shouldCountAttempt(ex, input.to, input.reasonCode);

  await ex.execute(sql`
    UPDATE shipments SET
      status = ${input.to},
      status_updated_at = now(),
      version = version + 1,
      last_reason_code = ${input.reasonCode ?? sql`last_reason_code`},
      attempts_count = attempts_count + ${attemptsInc ? 1 : 0},
      current_courier_id = ${
        input.courierId !== undefined ? sql`${input.courierId}::uuid` : sql`current_courier_id`
      },
      current_run_sheet_id = ${
        input.runSheetId !== undefined ? sql`${input.runSheetId}::uuid` : sql`current_run_sheet_id`
      },
      current_pickup_id = ${
        input.pickupId !== undefined ? sql`${input.pickupId}::uuid` : sql`current_pickup_id`
      },
      first_assigned_at = ${
        input.to === "pickup_assigned"
          ? sql`COALESCE(first_assigned_at, now())`
          : sql`first_assigned_at`
      },
      promised_at = ${promisedAt ? sql`${promisedAt.toISOString()}` : sql`promised_at`},
      delivered_at = ${
        input.to === "delivered" || input.to === "partially_delivered"
          ? sql`now()`
          : sql`delivered_at`
      },
      cod_collected_p = ${input.cod ? sql`${input.cod.collectedP.toString()}::bigint` : sql`cod_collected_p`},
      cod_method = ${input.cod ? sql`${input.cod.method}` : sql`cod_method`},
      status_before_hold = ${
        input.to === "on_hold"
          ? sql`${fromStatus}`
          : fromStatus === "on_hold"
            ? sql`NULL`
            : sql`status_before_hold`
      },
      cancelled_at = ${input.to === "cancelled" ? sql`now()` : sql`cancelled_at`},
      cancel_reason = ${input.to === "cancelled" ? sql`${input.note ?? null}` : sql`cancel_reason`},
      updated_at = now()
    WHERE id = ${input.shipmentId}::uuid
  `);

  // ═══ ٨) سطر التدقيق ═══
  await ex.execute(sql`
    INSERT INTO audit_log
      (actor_user_id, actor_role, actor_name, action, entity_type, entity_id,
       before, after, ip, user_agent, request_id)
    VALUES (
      ${input.actor.userId ?? null}::uuid, ${input.actor.role}, ${input.actor.name},
      ${"shipment.transition"}, ${"shipment"}, ${input.shipmentId},
      ${JSON.stringify({ status: fromStatus, version: ship.version })},
      ${JSON.stringify({ status: input.to, version: ship.version + 1, journalEntryNo: journalEntryNo?.toString() ?? null })},
      ${input.ip ?? null}, ${input.userAgent ?? null}, ${input.requestId ?? null}
    )
  `);

  return {
    shipmentId: ship.id,
    awb: ship.awb,
    fromStatus,
    toStatus: input.to,
    version: ship.version + 1,
    historyId,
    journalEntryNo,
    idempotentReplay: false,
    promisedAt: promisedAt ?? (ship.promised_at ? new Date(ship.promised_at) : null),
  };
}

// ---------------------------------------------------------------
// حساب الموعد المتوقع عند دخول المخزن
// ---------------------------------------------------------------

/**
 * الموعد المتوقع بيتحسب **مرة واحدة بس** عند دخول المخزن.
 * بعد كده عمره ما يتغيّر — الوعد للعميل ثابت.
 */
async function computeNextPromisedAt(
  ex: SqlExecutor,
  to: ShipmentStatus,
  ship: ShipmentRow
): Promise<Date | null> {
  if (to !== "at_hub") return null;
  if (ship.promised_at) return null; // اتحسب قبل كده — ثابت

  // SLA: تجاوز المحافظة بيتفوق على المنطقة
  const rows = rowsOf<{
    sla_working_hours: number | null;
    sla_working_days_min: number | null;
    sla_working_days_max: number | null;
    sla_override_hours: number | null;
  }>(
    await ex.execute(sql`
      SELECT z.sla_working_hours, z.sla_working_days_min, z.sla_working_days_max,
             g.sla_override_hours
      FROM shipments s
      JOIN zones z ON z.id = s.zone_id
      JOIN governorates g ON g.id = s.governorate_id
      WHERE s.id = ${ship.id}::uuid
    `)
  );
  const r = rows[0];
  if (!r) return null;

  const sla: SlaConfig = r.sla_override_hours
    ? { workingHours: r.sla_override_hours }
    : {
        workingHours: r.sla_working_hours,
        workingDaysMin: r.sla_working_days_min,
        workingDaysMax: r.sla_working_days_max,
      };

  const cfg = await loadWorkingTimeConfig(ex);
  return computePromisedAt(new Date(), sla, cfg);
}

/** تحميل ساعات العمل والعطلات — لحساب الـ SLA */
async function loadWorkingTimeConfig(ex: SqlExecutor): Promise<WorkingTimeConfig> {
  const wh = rowsOf<{
    day_of_week: number;
    open_time: string | null;
    close_time: string | null;
    is_working_day: boolean;
  }>(
    await ex.execute(sql`
      SELECT day_of_week, open_time, close_time, is_working_day FROM working_hours
    `)
  );
  const hol = rowsOf<{ date: string; name_ar: string; is_working_day: boolean }>(
    await ex.execute(sql`SELECT date, name_ar, is_working_day FROM holidays`)
  );
  return {
    workingHours: wh.map((w) => ({
      dayOfWeek: w.day_of_week,
      openTime: w.open_time,
      closeTime: w.close_time,
      isWorkingDay: w.is_working_day,
    })),
    holidays: hol.map((h) => ({ date: h.date, nameAr: h.name_ar, isWorkingDay: h.is_working_day })),
    timeZone: "Africa/Cairo",
  };
}

/** التعذّر بيتحسب محاولة؟ التأجيل بطلب العميل مش محاولة */
async function shouldCountAttempt(
  ex: SqlExecutor,
  to: ShipmentStatus,
  reasonCode: string | undefined
): Promise<boolean> {
  if (to !== "delivery_failed" || !reasonCode) return false;
  const rows = rowsOf<{ counts_as_attempt: boolean }>(
    await ex.execute(sql`
      SELECT counts_as_attempt FROM shipment_reason_codes WHERE code = ${reasonCode}
    `)
  );
  return rows[0]?.counts_as_attempt ?? true;
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
