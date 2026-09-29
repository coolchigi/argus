"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { EyeMark } from "@/components/argus/eye-mark";
import { ProgressLine } from "@/components/argus/progress-line";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Signed-in frame for the setup wizard. Same session check as AppShell, with
 * no sidebar: the wizard's own buttons are the only way forward or out.
 */
export function OnboardingShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (auth.status === "anonymous") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status !== "authed") {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <ProgressLine active fixed label="Checking your session" />
        <div className="label">Loading</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-hairline bg-canvas">
        <div className="mx-auto flex h-14 max-w-[880px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <EyeMark />
            <span className="font-display text-[20px] leading-none text-ink-1">Argus</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
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
      </header>
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-[880px] px-4 py-8 sm:px-6 lg:py-12">{children}</div>
      </main>
    </div>
  );
}
