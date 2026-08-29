"use client";

/**
 * شريط التنقّل بين شاشات الإدارة.
 * الروابط بتظهر حسب دور المستخدم.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  roles: string[];
}

const ITEMS: NavItem[] = [
  { href: "/", label: "الشحنات", roles: ["super_admin", "branch_manager", "ops", "accountant", "support"] },
  { href: "/pickups", label: "الاستلام", roles: ["super_admin", "branch_manager", "ops"] },
  { href: "/scan", label: "المسح", roles: ["super_admin", "branch_manager", "ops"] },
  { href: "/runsheets", label: "الكشوف", roles: ["super_admin", "branch_manager", "ops", "accountant"] },
  { href: "/returns", label: "المرتجعات", roles: ["super_admin", "branch_manager", "ops", "accountant"] },
  { href: "/merchants", label: "التجار", roles: ["super_admin", "branch_manager", "ops", "accountant"] },
  { href: "/treasury", label: "الخزينة", roles: ["super_admin", "branch_manager", "accountant"] },
  { href: "/settlements", label: "التسويات", roles: ["super_admin", "branch_manager", "accountant"] },
  { href: "/claims", label: "المطالبات", roles: ["super_admin", "branch_manager", "accountant", "ops"] },
  { href: "/tasks", label: "التشغيل", roles: ["super_admin", "branch_manager", "ops", "accountant", "support"] },
  { href: "/reports", label: "التقارير", roles: ["super_admin", "branch_manager", "accountant", "ops"] },
  { href: "/team", label: "الفريق", roles: ["super_admin", "branch_manager"] },
];

export function AppNav({ role }: { role: string }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => i.roles.includes(role));

  return (
    <nav
      style={{
        display: "flex",
        gap: 4,
        padding: "0 1.25rem",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        position: "sticky",
        top: 0,
        zIndex: 15,
      }}
    >
      {items.map((i) => {
        const active = i.href === "/" ? pathname === "/" : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            style={{
              padding: "0.8rem 1rem",
              fontWeight: 700,
              fontSize: "0.9rem",
              color: active ? "var(--color-orange-600)" : "var(--muted)",
              borderBottom: active ? "2px solid var(--color-orange-500)" : "2px solid transparent",
            }}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
