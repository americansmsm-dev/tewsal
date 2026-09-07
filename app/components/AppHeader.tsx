"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../lib/client";
import { NotificationBell } from "./NotificationBell";

export interface CurrentUser {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  merchantId?: string | null;
}

export function AppHeader({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem("tewsal-theme");
      } catch {
        return null;
      }
    })();
    const isDark =
      saved === "dark" ||
      (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("tewsal-theme", next ? "dark" : "light");
    } catch {
      /* تجاهل */
    }
  }

  async function logout() {
    await apiCall("POST", "/api/v1/auth/logout");
    router.replace("/login");
  }

  return (
    // ⚠️ التنسيق في globals.css مش inline — عشان الـmedia query
    //    تقدر تخفي الزيادة على الفون (المحتوى كان محتاج ٤٤٧px)
    <header className="app-header">
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span style={{ fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          <span style={{ color: "var(--color-orange-500)" }}>توصّل</span>
        </span>
        <span className="app-header-sub" style={{ fontSize: "0.8rem", opacity: 0.6 }}>نظام إدارة الشحنات</span>
      </div>

      <div className="app-header-actions">
        <NotificationBell />
        <button
          onClick={toggleTheme}
          className="btn btn-ghost"
          style={{ padding: "0.4rem 0.6rem", color: "#fff", borderColor: "#ffffff33" }}
          title="الوضع الليلي"
        >
          {dark ? "☀️" : "🌙"}
        </button>
        <div style={{ textAlign: "left", lineHeight: 1.2, minWidth: 0 }}>
          <div className="app-header-name" style={{ fontWeight: 700, fontSize: "0.85rem" }}>{user.name}</div>
          <div className="app-header-role" style={{ fontSize: "0.7rem", opacity: 0.6 }}>{user.roleLabel}</div>
        </div>
        <button
          onClick={logout}
          className="btn btn-ghost"
          style={{ color: "#fff", borderColor: "#ffffff33", fontSize: "0.8rem" }}
        >
          خروج
        </button>
      </div>
    </header>
  );
}
