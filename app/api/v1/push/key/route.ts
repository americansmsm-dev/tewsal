/**
 * GET /api/v1/push/key — المفتاح العام (VAPID) وحالة تفعيل الدفع.
 *
 * المفتاح ده **عام بطبيعته** — المتصفح محتاجه عشان يعمل الاشتراك،
 * وهو مش سر (السر هو المفتاح الخاص وده على السيرفر بس).
 * محتاج دخول برضو عشان مانبانش إعدادات السيستم لأي حد.
 */
import { type NextRequest } from "next/server";
import { requireUser } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";
import { isPushConfigured, vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return ok({ enabled: isPushConfigured(), publicKey: vapidPublicKey() });
  } catch (err) {
    return handleError(err);
  }
}
