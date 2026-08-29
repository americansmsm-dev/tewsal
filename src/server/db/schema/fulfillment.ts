/**
 * ============================================================
 *  تخزين التجار (فُلفيلمنت) — مرحلة ز
 * ------------------------------------------------------------
 *  merchant_products — منتجات التاجر المخزّنة عندنا (SKU/كمية)
 *  stock_movements   — حركة المخزون (إضافة/خصم/سحب مع شحنة)
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { merchants } from "./merchants";
import { shipments } from "./shipments";

export const merchantProducts = pgTable(
  "merchant_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    nameAr: text("name_ar").notNull(),
    category: text("category"),
    /** سعر البيع للعميل (اختياري) */
    priceP: bigint("price_p", { mode: "bigint" }).notNull().default(sql`0`),
    quantity: integer("quantity").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // SKU فريد لكل تاجر
    uniqueIndex("merchant_products_sku_uq").on(t.merchantId, t.sku),
    index("merchant_products_merchant_idx").on(t.merchantId, t.isActive),
  ]
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => merchantProducts.id, { onDelete: "cascade" }),
    /** موجب = إضافة · سالب = خصم/سحب */
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    /** restock · adjust · shipment · return */
    reason: text("reason").notNull(),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_movements_idx").on(t.productId, t.createdAt)]
);
