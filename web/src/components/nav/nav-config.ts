import type { NavIconName } from "@/components/nav/nav-icons";

/**
 * action-required: affected assessments with no sent brief (danger).
 * policy-events: policy events whose status is action-required (brand).
 * setup: "N of M" setup steps done, hidden once setup is complete (brand).
 */
export type NavBadge = "action-required" | "policy-events" | "setup";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  badge?: NavBadge;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "monitor",
    label: "Monitor",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/policy-events", label: "Policy events", icon: "policy", badge: "policy-events" },
      { href: "/caseload", label: "Client caseload", icon: "clients" },
      { href: "/impacts", label: "Assessments", icon: "assess", badge: "action-required" },
      { href: "/briefs", label: "Action briefs", icon: "briefs" },
    ],
  },
  {
    id: "public",
    label: "Public",
    items: [{ href: "/verify", label: "Verify a receipt", icon: "verify" }],
  },
];

export const NAV_BOTTOM: NavItem[] = [
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/records", label: "Records", icon: "records" },
  { href: "/setup", label: "Setup guide", icon: "setup", badge: "setup" },
];

const ALL_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_BOTTOM];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item that owns a path, for the breadcrumb's section crumb. */
export function navItemForPath(pathname: string): NavItem | null {
  return ALL_ITEMS.find((item) => isActivePath(pathname, item.href)) ?? null;
}
