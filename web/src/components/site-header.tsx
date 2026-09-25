import type { ReactNode } from "react";
import Link from "next/link";
import { Seal } from "@/components/seal";
import { ThemeToggle } from "@/components/theme-toggle";

// 56px header, rhymes with the 240px sidebar's 56px brand row.
// Header stays static so the public verify page's fixed 2px seal bar can sit above it.
export function SiteHeader({ nav }: { nav?: ReactNode }) {
  return (
    <header className="border-b border-border bg-canvas">
      <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          aria-label="Argus, home"
        >
          <Seal className="h-[18px] w-[18px] text-seal" />
          <span className="text-[15px] font-medium tracking-tight text-ink-primary">argus</span>
        </Link>
        <div className="flex items-center gap-2">
          {nav && (
            <nav className="mr-2 flex items-center gap-5 text-[13px]">{nav}</nav>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
