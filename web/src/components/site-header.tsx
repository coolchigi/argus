"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EyeMark } from "@/components/argus/eye-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/components/auth-context";

/**
 * Header for public pages (landing, auth, receipts). A signed-in consultant
 * always gets a clear way back to the app, so no public page is a dead end.
 * `nav` holds the signed-out links (e.g. Sign in) and is hidden once signed in.
 */
export function SiteHeader({ nav }: { nav?: ReactNode }) {
  const auth = useAuth();
  const authed = auth.status === "authed";

  return (
    <header className="border-b border-hairline bg-canvas" data-print="hide">
      <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={authed ? "/dashboard" : "/"} className="flex items-center gap-2.5 rounded-sm">
          <EyeMark />
          <span className="font-display text-[20px] leading-none text-ink-1">Argus</span>
        </Link>
        <div className="flex items-center gap-4">
          {authed ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-sm border border-control px-3 py-1.5 text-[13px] font-medium text-ink-1 hover:bg-sunk"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              Back to dashboard
            </Link>
          ) : (
            auth.status !== "loading" &&
            nav && <nav aria-label="Site" className="flex items-center gap-6 text-[13px]">{nav}</nav>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
