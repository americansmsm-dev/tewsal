/**
 * POST /api/v1/notifications/send — المُرسِل اليدوي (الإدارة).
 * المالك بيبعت إشعار لأي: دور معيّن / تاجر / مندوب / مستخدم واحد / الكل.
 * بيكتب صفوف في notifications (قناة داخلية). واتساب لاحقًا.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";
import { USER_ROLES } from "@/server/db/schema/identity";
import { notifyUsers, usersByRole, merchantUserIds } from "@/server/services/inappNotify";

export const dynamic = "force-dynamic";
const SENDERS = ["super_admin", "branch_manager"] as const;

const schema = z.object({
  target: z.object({
    type: z.enum(["all", "role", "merchant", "courier", "user"]),
    // role: اسم الدور · merchant: معرّف التاجر · courier/user: معرّف المستخدم
    value: z.string().max(80).nullable().optional(),
  }),
  title: z.string().min(1).max(140),
  body: z.string().min(1).max(1000),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, SENDERS);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const { target, title, body } = parsed.data;

    let userIds: string[] = [];
    switch (target.type) {
      case "all":
        userIds = await usersByRole(db, null);
        break;
      case "role":
        if (!target.value || !(USER_ROLES as readonly string[]).includes(target.value)) {
          return fail("BAD_REQUEST", "اختار دور صحيح", 400);
        }
        userIds = await usersByRole(db, target.value);
        break;
      case "merchant":
        if (!target.value) return fail("BAD_REQUEST", "اختار التاجر", 400);
        userIds = await merchantUserIds(db, target.value);
        break;
      case "courier":
      case "user":
        if (!target.value) return fail("BAD_REQUEST", "اختار المستخدم", 400);
        userIds = [target.value];
        break;
    }

    const sent = await notifyUsers(db, {
      userIds,
      event: "manual",
      titleAr: title,
      bodyAr: body,
      createdBy: ctx.user.userId,
    });

    if (sent === 0) return fail("NO_RECIPIENTS", "مفيش مستلمين مطابقين", 422);
    return ok({ sent }, 201);
  } catch (err) {
    return handleError(err);
  }
}
