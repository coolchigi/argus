import type { ReactNode } from "react";
import Link from "next/link";
import { EyeMark } from "@/components/argus/eye-mark";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader({ nav }: { nav?: ReactNode }) {
  return (
    <header className="border-b border-hairline bg-canvas" data-print="hide">
      <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-sm">
          <EyeMark />
          <span className="font-display text-[20px] leading-none text-ink-1">Argus</span>
        </Link>
        <div className="flex items-center gap-4">
          {nav && <nav aria-label="Site" className="flex items-center gap-6 text-[13px]">{nav}</nav>}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
