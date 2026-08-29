/**
 * ============================================================
 *  التكاملات والـ API — مرحلة ح
 * ------------------------------------------------------------
 *  api_tokens         — توكنات التجار للـ API العام (hash فقط)
 *  webhook_endpoints  — نقاط استقبال التجار للأحداث
 *  webhook_deliveries — سجل إرسال الويب-هوك
 *  import_batches     — دفعات الاستيراد بمعاينة الأخطاء
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { merchants } from "./merchants";

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** sha256 للتوكن — التوكن نفسه بيتعرض مرة واحدة عند الإنشاء */
    tokenHash: text("token_hash").notNull(),
    /** أول ٨ حروف للعرض */
    prefix: text("prefix").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_uq").on(t.tokenHash),
    index("api_tokens_merchant_idx").on(t.merchantId, t.isActive),
  ]
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** الأحداث المشترك فيها، مفصولة بفاصلة (delivered,delivery_failed,...) */
    events: text("events").notNull().default("*"),
    secret: text("secret"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_merchant_idx").on(t.merchantId, t.isActive)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    statusCode: integer("status_code"),
    ok: boolean("ok").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_deliveries_idx").on(t.endpointId, t.createdAt)]
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    total: integer("total").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("import_batches_code_uq").on(t.code)]
);
