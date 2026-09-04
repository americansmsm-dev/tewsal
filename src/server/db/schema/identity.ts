/**
 * ============================================================
 *  الهوية والصلاحيات
 * ------------------------------------------------------------
 *  الجلسات بتتخزن في قاعدة البيانات (مش JWT) عشان:
 *   - نقدر نلغي جلسة فورًا (موظف مشي، موبايل اتسرق)
 *   - المندوب ليه جلسة ٩٠ يوم متجددة، والموظف ١٢ ساعة
 *   - نشوف مين داخل من فين دلوقتي
 *
 *  الصلاحيات **دقيقة لكل إجراء** مش أدوار جامدة — الدور
 *  بيدي مجموعة صلاحيات افتراضية، وتقدر تزود أو تشيل لأي
 *  مستخدم على حدة من الشاشة.
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** الأدوار — متطابقة مع statusMachine.ts */
export const USER_ROLES = [
  "super_admin",
  "branch_manager",
  "ops",
  "data_entry",
  "courier",
  "merchant",
  "accountant",
  "support",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS_AR: Record<UserRole, string> = {
  super_admin: "مدير النظام",
  branch_manager: "مدير الفرع",
  ops: "مسؤول المخزن",
  data_entry: "موظف إدخال بيانات",
  courier: "مندوب",
  merchant: "تاجر",
  accountant: "محاسب",
  support: "خدمة العملاء",
};

/** الفروع — واحد دلوقتي، والنموذج جاهز للتوسّع */
export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    governorateId: uuid("governorate_id"),
    address: text("address"),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("branches_code_uq").on(t.code)]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    username: text("username").notNull(),
    phone: text("phone"),
    email: text("email"),
    /** بروفايل: صورة (R2) وعنوان */
    avatarUrl: text("avatar_url"),
    address: text("address"),
    /** argon2id — مفيش أي مكان تاني بيعمل hash */
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    /** لو الدور تاجر — بيربطه بسجل التاجر (بوابة التاجر بتفلتر بيه) */
    merchantId: uuid("merchant_id"),
    /** صلاحيات إضافية فوق صلاحيات الدور */
    extraPermissions: text("extra_permissions").array().notNull().default([]),
    /** صلاحيات مسحوبة من صلاحيات الدور */
    revokedPermissions: text("revoked_permissions").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    /** 2FA إجباري للإدارة والمالية */
    twoFactorSecret: text("two_factor_secret"),
    twoFactorEnabledAt: timestamp("two_factor_enabled_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_uq").on(t.username),
    uniqueIndex("users_phone_uq").on(t.phone),
    index("users_role_idx").on(t.role, t.isActive),
    index("users_branch_idx").on(t.branchId),
  ]
);

/**
 * الجلسات — المعرّف المخزّن هو sha256 للتوكن،
 * مش التوكن نفسه. يعني حتى لو حد قرا الجدول
 * مش هيقدر ينتحل جلسة.
 */
export const sessions = pgTable(
  "sessions",
  {
    /** sha256(token) */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** اسم الجهاز عشان المستخدم يعرف يلغي جلسة معيّنة */
    deviceLabel: text("device_label"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ]
);

/** محاولات الدخول — للكشف عن هجمات التخمين */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    success: boolean("success").notNull(),
    failureReason: text("failure_reason"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_attempts_username_idx").on(t.username, t.attemptedAt),
    index("login_attempts_ip_idx").on(t.ip, t.attemptedAt),
  ]
);

/**
 * سجل التدقيق — كل تغيير في السيستم.
 * ⚠️ دور قاعدة البيانات بتاع التطبيق **مالوش UPDATE ولا DELETE**
 *    على الجدول ده. حتى لو حد وصل للسيرفر مقدرش يمسح أثره.
 *    مقسّم شهريًا عشان يفضل سريع.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id"),
    actorRole: text("actor_role"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    /** الحالة قبل وبعد — jsonb عشان أي شكل */
    before: text("before"),
    after: text("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_actor_idx").on(t.actorUserId, t.occurredAt),
    index("audit_time_idx").on(t.occurredAt),
  ]
);
