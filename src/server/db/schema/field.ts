/**
 * ============================================================
 *  الميدان — مواقع وحضور المناديب (مرحلة ي)
 * ------------------------------------------------------------
 *  courier_locations  — GPS أثناء الجولة (بموافقة المندوب)
 *  courier_attendance — حضور وانصراف يومي
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const courierLocations = pgTable(
  "courier_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courierId: uuid("courier_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("courier_locations_idx").on(t.courierId, t.recordedAt)]
);

export const courierAttendance = pgTable(
  "courier_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courierId: uuid("courier_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD بتوقيت القاهرة */
    day: text("day").notNull(),
    checkInAt: timestamp("check_in_at", { withTimezone: true }),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("courier_attendance_uq").on(t.courierId, t.day)]
);
