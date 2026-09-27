"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-context";
import { Sidebar } from "@/components/nav/sidebar";
import { TopBar } from "@/components/nav/top-bar";
import { BreadcrumbProvider } from "@/components/nav/breadcrumb-context";
import { ProgressLine } from "@/components/argus/progress-line";

export function AppShell({ children }: { children: React.ReactNode }) {
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
