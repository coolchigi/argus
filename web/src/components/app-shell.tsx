"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-context";
import { useTheme } from "@/components/theme-provider";
import { Seal } from "@/components/seal";
import { cn } from "@/lib/utils";
import { LayoutDashboard, FileSignature, Mail, LogOut, Sun, Moon, Monitor } from "lucide-react";

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
    if (auth.status === "anonymous") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status !== "authed") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="label">Loading</div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-canvas">
      <aside className="flex flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center gap-2 px-4">
          <Seal className="h-4 w-4 text-seal" />
          <span className="text-[15px] font-medium tracking-tight text-ink-primary">Argus</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-[13px] transition-colors",
                  active
                    ? "bg-surface-alt text-ink-primary font-medium"
                    : "text-ink-secondary hover:bg-surface-alt/60 hover:text-ink-primary",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3 space-y-3">
          <ThemeToggle />
          <div className="px-1">
            <div className="text-[13px] text-ink-primary leading-tight">
              {auth.claims.givenName} {auth.claims.familyName}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-tertiary tabular truncate">
              {auth.claims.rcicLicense ? `RCIC ${auth.claims.rcicLicense}` : auth.claims.email}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              auth.signOut();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-1.5 px-1 py-1 text-[11px] text-ink-tertiary transition-colors hover:text-ink-primary"
          >
            <LogOut className="h-3 w-3" strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-10 py-10">{children}</div>
      </main>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const options: Array<{ value: "light" | "dark" | "system"; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string }> = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];
  return (
    <div className="grid grid-cols-3 gap-0.5 rounded-sm border border-border p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.label}
            aria-label={o.label}
            onClick={() => setTheme(o.value)}
            className={cn(
              "flex h-6 items-center justify-center rounded-[3px] transition-colors",
              active ? "bg-surface-alt text-ink-primary" : "text-ink-tertiary hover:text-ink-primary",
            )}
          >
            <Icon className="h-3 w-3" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
