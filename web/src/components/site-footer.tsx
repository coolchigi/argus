import { Seal } from "@/components/seal";

// 56px footer, symmetric with the site header.
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-canvas">
      <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between px-6">
        <div className="flex items-center gap-2 text-[11px] text-ink-tertiary">
          <Seal className="h-3 w-3 text-ink-tertiary" filled={false} />
          <span>argus, signed and archived</span>
        </div>
        <div className="text-[11px] text-ink-tertiary tabular">
          Built for CICC-licensed consultants
        </div>
      </div>
    </footer>
  );
}
