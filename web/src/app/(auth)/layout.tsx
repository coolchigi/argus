import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1 flex items-start justify-center px-4 pt-16 pb-12">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
