import type { ReactNode } from "react";
import Link from "next/link";
import { Seal } from "@/components/seal";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader({ nav }: { nav?: ReactNode }) {
  return (
    <header className="border-b border-border bg-canvas">
      <div className="mx-auto max-w-[1080px] px-6 h-14 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2">
          <Seal className="h-4 w-4 text-seal" />
          <span className="text-[14px] font-medium tracking-tight text-ink-primary">argus</span>
        </Link>
        <div className="flex items-center gap-4">
          {nav && <nav className="flex items-center gap-6 text-[13px]">{nav}</nav>}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
