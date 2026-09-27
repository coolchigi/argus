"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { EyeMark } from "@/components/argus/eye-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavIcon } from "@/components/nav/nav-icons";
import { NAV_BOTTOM, NAV_GROUPS, isActivePath, type NavItem } from "@/components/nav/nav-config";
import { useActionRequiredCount } from "@/lib/queries";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * The app sidebar. Rendered fixed on wide screens and inside the mobile drawer
 * below 1024px. `onNavigate` lets the drawer close after a link is followed.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const authed = auth.status === "authed";
  const actionRequired = useActionRequiredCount({ enabled: authed });
  const sha = env.buildSha ? env.buildSha.slice(0, 7) : null;

  function renderItem(item: NavItem) {
    const active = isActivePath(pathname, item.href);
    const badgeCount = item.badge === "action-required" ? actionRequired : null;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
          className={cn(
            "flex h-9 items-center gap-2.5 border-l-2 px-3 text-[13px] transition-colors focus-visible:outline-offset-[-2px]",
            active
              ? "border-brand-ink bg-brand-subtle font-medium text-ink-1"
              : "border-transparent text-ink-2 hover:bg-sunk hover:text-ink-1",
          )}
        >
          <NavIcon name={item.icon} className={active ? "text-brand-ink" : "text-ink-3"} />
          <span>{item.label}</span>
          {badgeCount !== null && badgeCount > 0 && (
            <span className="ml-auto rounded-sm bg-danger-subtle px-1.5 font-mono text-[11px] leading-5 text-danger-ink tabular">
              <span aria-hidden>{badgeCount}</span>
              <span className="sr-only">
                , {badgeCount} {badgeCount === 1 ? "needs" : "need"} action
              </span>
            </span>
          )}
        </Link>
      </li>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-hairline px-5 pb-4 pt-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex w-fit items-center gap-2.5 rounded-sm"
          aria-label="Argus dashboard"
        >
          <EyeMark />
          <span className="font-display text-[20px] leading-none text-ink-1">Argus</span>
        </Link>
        <div className="mt-1.5 font-mono text-[11px] tracking-[0.08em] text-ink-3">
          IRCC monitor{sha ? ` · build ${sha}` : ""}
        </div>
      </div>

      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.id} className={gi > 0 ? "mt-4" : undefined}>
              <div id={`nav-${group.id}`} className="label px-3 pb-1.5 pt-2">
                {group.label}
              </div>
              <ul aria-labelledby={`nav-${group.id}`} className="space-y-0.5">
                {group.items.map(renderItem)}
              </ul>
            </div>
          ))}
        </div>
        <ul className="space-y-0.5 border-t border-hairline px-2 py-2">{NAV_BOTTOM.map(renderItem)}</ul>
      </nav>

      <div className="border-t border-hairline px-5 py-4">
        <div className="label mb-1.5">Signed in</div>
        {authed ? (
          <>
            <div className="truncate text-[13px] text-ink-1">
              {[auth.claims.givenName, auth.claims.familyName].filter(Boolean).join(" ") || auth.claims.email}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-ink-2">
              {auth.claims.rcicLicense ? `RCIC ${auth.claims.rcicLicense}` : auth.claims.email}
            </div>
          </>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              auth.signOut();
              router.replace("/login");
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] text-ink-2 transition-colors hover:bg-sunk hover:text-ink-1"
          >
            <LogOut aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
