import { Seal } from "@/components/seal";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-canvas">
      <div className="mx-auto max-w-[1080px] px-6 py-6 flex items-center justify-between">
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
