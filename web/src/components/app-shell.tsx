"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-context";
import { Sidebar } from "@/components/nav/sidebar";
import { TopBar } from "@/components/nav/top-bar";
import { BreadcrumbProvider } from "@/components/nav/breadcrumb-context";
import { ProgressLine } from "@/components/argus/progress-line";
import { needsOnboarding } from "@/lib/onboarding";
import { useMe } from "@/lib/queries";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const auth = useAuth();
  const me = useMe({ enabled: auth.status === "authed" });
  // A failed /me lets the app render. Pages show their own errors, and a
  // consultant is never locked out by the wizard's gate.
  const toOnboarding = me.data ? needsOnboarding(me.data) : false;

  useEffect(() => {
    if (auth.status === "anonymous") router.replace("/login");
  }, [auth.status, router]);

  useEffect(() => {
    if (toOnboarding) router.replace("/onboarding");
  }, [toOnboarding, router]);

  // Hold the shell until /me answers, so a new consultant never sees the
  // dashboard flash before the redirect.
  if (auth.status !== "authed" || (me.isPending && !me.isError) || toOnboarding) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <ProgressLine active fixed label="Checking your session" />
        <div className="label">Loading</div>
      </div>
    );
  }

  return (
    <BreadcrumbProvider>
      <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[228px_minmax(0,1fr)]">
        <aside
          data-print="hide"
          className="hidden border-r border-hairline lg:sticky lg:top-0 lg:block lg:h-screen lg:self-start"
        >
          <Sidebar />
        </aside>
        <div className="flex min-w-0 flex-col">
          <TopBar />
          <main id="main" className="min-w-0 flex-1">
            <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
