"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-context";
import { cn } from "@/lib/utils";
import { LayoutDashboard, FileSignature, Mail, LogOut } from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/impacts", label: "Assessments", icon: FileSignature },
  { href: "/briefs", label: "Briefs", icon: Mail },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const auth = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (auth.status === "anonymous") {
      router.replace("/login");
    }
  }, [auth.status, router]);

  if (auth.status !== "authed") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-xs text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-[208px_1fr] bg-background">
      <aside className="flex flex-col border-r border-border bg-sidebar">
        <div className="flex h-12 items-center gap-2 border-b border-sidebar-border px-4">
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-foreground" aria-hidden>
            <circle cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeWidth="1" />
            <circle cx="8" cy="8" r="2.5" fill="currentColor" />
          </svg>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">Argus</span>
        </div>

        <nav className="flex-1 py-2">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "mx-2 flex h-7 items-center gap-2 rounded-sm px-2 text-[13px] transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 px-1 text-[11px] leading-tight">
            <div className="truncate font-medium text-sidebar-foreground">
              {auth.claims.givenName} {auth.claims.familyName}
            </div>
            <div className="truncate text-muted-foreground">{auth.claims.rcicLicense ?? auth.claims.email}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              auth.signOut();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="h-3 w-3" strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
