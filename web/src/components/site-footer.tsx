import { EyeMark } from "@/components/argus/eye-mark";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline bg-canvas" data-print="hide">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-2 px-4 py-6 sm:px-6">
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <EyeMark className="h-3.5 w-3.5 text-ink-3" />
          <span>Argus, signed and archived</span>
        </div>
        <div className="text-[12px] text-ink-3">Built for CICC-licensed consultants</div>
      </div>
    </footer>
  );
}
