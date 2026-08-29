/**
 * ============================================================
 *  الصلاحيات الدقيقة — مرحلة ط
 * ------------------------------------------------------------
 *  طبقة **فوق** الأدوار: كل دور له صلاحيات افتراضية، والإدارة
 *  تقدر تدي صلاحية إضافية (extra) أو تسحب صلاحية (revoked) لأي
 *  مستخدم. الأدوار ماتتلغيش — دي زيادة دقة فوقها.
 * ============================================================
 */
export const PERMISSIONS = [
  "settlement.run",
  "settlement.approve",
  "settlement.pay",
  "shipment.reverse",
  "expense.record",
  "merchant.manage",
  "user.manage",
  "reports.finance",
  "emergency.toggle",
  "invoice.issue",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS_AR: Record<Permission, string> = {
  "settlement.run": "تشغيل التسويات",
  "settlement.approve": "اعتماد التسويات",
  "settlement.pay": "دفع التسويات",
  "shipment.reverse": "عكس عملية شحنة",
  "expense.record": "تسجيل المصروفات",
  "merchant.manage": "إدارة التجار",
  "user.manage": "إدارة المستخدمين",
  "reports.finance": "التقارير المالية",
  "emergency.toggle": "وضع الطوارئ",
  "invoice.issue": "إصدار الفواتير الضريبية",
};

/** الصلاحيات الافتراضية لكل دور. super_admin = الكل. */
const ROLE_PERMISSIONS: Record<string, Permission[] | "*"> = {
  super_admin: "*",
  branch_manager: ["settlement.run", "settlement.approve", "settlement.pay", "expense.record", "merchant.manage", "user.manage", "reports.finance", "invoice.issue"],
  accountant: ["settlement.run", "settlement.approve", "settlement.pay", "expense.record", "reports.finance", "invoice.issue"],
  ops: ["merchant.manage"],
  support: [],
  courier: [],
  merchant: [],
};

export interface PermissionUser {
  role: string;
  extraPermissions: string[];
  revokedPermissions: string[];
}

/** هل المستخدم عنده الصلاحية دي؟ (سحب > إضافة > افتراضي الدور) */
export function hasPermission(user: PermissionUser, perm: Permission): boolean {
  if (user.revokedPermissions.includes(perm)) return false;
  if (user.extraPermissions.includes(perm)) return true;
  const rolePerms = ROLE_PERMISSIONS[user.role];
  if (rolePerms === "*") return true;
  return (rolePerms ?? []).includes(perm);
}

/** كل صلاحيات المستخدم الفعّالة — للعرض. */
export function effectivePermissions(user: PermissionUser): Permission[] {
  return PERMISSIONS.filter((p) => hasPermission(user, p));
}
