"use client";

/**
 * خطّاف المستخدم الحالي — بيفحص الجلسة ويحمي الصفحة.
 * مفيش جلسة → تحويل لـ /login. بيرجّع null أثناء التحميل.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "./client";
import type { CurrentUser } from "../components/AppHeader";

export interface UseCurrentUserOptions {
  /**
   * شاشات مشتركة بين كل الأدوار (زي الإشعارات) لازم تسمح للتاجر
   * والمندوب. من غير الخيار ده الخطّاف بيرجّعهم لبوابتهم —
   * وده كان بيخلّي زرار «كل الإشعارات» في الجرس يرجّعهم لورا.
   */
  allowPortalRoles?: boolean;
}

export function useCurrentUser(options: UseCurrentUserOptions = {}): CurrentUser | null {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const allowPortalRoles = options.allowPortalRoles ?? false;

  useEffect(() => {
    apiCall<{ user: CurrentUser }>("GET", "/api/v1/auth/me").then((r) => {
      if (!r.ok) {
        router.replace("/login");
        return;
      }
      // التاجر والمندوب مالهمش شاشات الإدارة — كل واحد لبوابته
      const role = r.data!.user.role;
      if (!allowPortalRoles) {
        if (role === "merchant") { router.replace("/portal"); return; }
        if (role === "courier") { router.replace("/courier"); return; }
      }
      setUser(r.data!.user);
    });
  }, [router, allowPortalRoles]);

  return user;
}
