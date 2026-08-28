/**
 * ============================================================
 *  أدوات الواجهة — نداء الـ API وعرض الحالات
 * ------------------------------------------------------------
 *  كل النداءات على نفس الأصل، فالكوكي بيتبعت تلقائيًا.
 *  الأخطاء بترجع برسالتها العربية من السيرفر.
 * ============================================================
 */
import {
  STATUS_LABELS_AR,
  allowedTransitions,
  type ShipmentStatus,
  type Role,
} from "@/server/domain/statusMachine";

export type { ShipmentStatus, Role };
export { STATUS_LABELS_AR, allowedTransitions };

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: ApiError | null;
}

export async function apiCall<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* بعض الردود بدون جسم */
  }
  if (res.ok) {
    return { ok: true, status: res.status, data: json as T, error: null };
  }
  const err = (json as { error?: ApiError })?.error ?? {
    code: "UNKNOWN",
    message: "حصل خطأ غير متوقع",
  };
  return { ok: false, status: res.status, data: null, error: err };
}

// ---------------------------------------------------------------
// ألوان الحالات — للـ badge
// ---------------------------------------------------------------

type Tone = "neutral" | "info" | "warn" | "success" | "danger";

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  awaiting_pickup: "info",
  pickup_assigned: "info",
  picked_up: "info",
  at_hub: "info",
  out_for_delivery: "warn",
  delivery_failed: "danger",
  delivered: "success",
  partially_delivered: "success",
  awaiting_return: "warn",
  out_for_return: "warn",
  returned_to_merchant: "neutral",
  lost: "danger",
  damaged: "danger",
  cancelled: "neutral",
  on_hold: "warn",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

export function toneStyle(tone: Tone): { background: string; color: string; borderColor: string } {
  const map: Record<Tone, [string, string]> = {
    neutral: ["#6b728022", "#6b7280"],
    info: ["#2563eb22", "#2563eb"],
    warn: ["#d9770622", "#d97706"],
    success: ["#16a34a22", "#16a34a"],
    danger: ["#dc262622", "#dc2626"],
  };
  const [bg, fg] = map[tone];
  return { background: bg, color: fg, borderColor: bg };
}

/** الأرقام العربية-الهندية — عرض فقط */
export function toArabicDigits(s: string | number): string {
  const western = "0123456789";
  const eastern = "٠١٢٣٤٥٦٧٨٩";
  return String(s).replace(/[0-9]/g, (d) => eastern[western.indexOf(d)] ?? d);
}
