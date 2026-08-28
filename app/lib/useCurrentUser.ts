"use client";

/**
 * خطّاف المستخدم الحالي — بيفحص الجلسة ويحمي الصفحة.
 * مفيش جلسة → تحويل لـ /login. بيرجّع null أثناء التحميل.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "./client";
import type { CurrentUser } from "../components/AppHeader";

export function useCurrentUser(): CurrentUser | null {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    apiCall<{ user: CurrentUser }>("GET", "/api/v1/auth/me").then((r) => {
      if (!r.ok) {
        router.replace("/login");
        return;
      }
      // التاجر والمندوب مالهمش شاشات الإدارة — كل واحد لبوابته
      const role = r.data!.user.role;
      if (role === "merchant") { router.replace("/portal"); return; }
      if (role === "courier") { router.replace("/courier"); return; }
      setUser(r.data!.user);
    });
  }, [router]);

  return user;
}
