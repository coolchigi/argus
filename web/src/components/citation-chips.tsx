"use client";

import { ArrowUpRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  liveUrl?: string | null;
  liveIsReachable?: boolean;
  archiveUrl?: string | null;
  archiveFingerprint?: string | null;
};

/**
 * The dual chip citation pattern (Section 8e).
 * Live IRCC link + signed snapshot fallback, side by side.
 */
export function CitationChips({ liveUrl, liveIsReachable, archiveUrl, archiveFingerprint }: Props) {
  if (!liveUrl && !archiveUrl) {
    return <span className="text-[12px] text-ink-tertiary">No citation available.</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {liveUrl && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[12px] transition-colors",
            "border border-border bg-surface text-ink-primary hover:bg-surface-alt",
            liveIsReachable === false && "border-amber/40 bg-amber-subtle text-ink-primary",
          )}
        >
          <span className="truncate max-w-[280px]">{shortenUrl(liveUrl)}</span>
          <ArrowUpRight className="h-3 w-3 text-ink-tertiary shrink-0" strokeWidth={1.75} />
          {liveIsReachable === false && (
            <span className="ml-1 rounded-sm bg-amber/20 px-1 py-0.5 text-[9px] uppercase tracking-wider text-amber">
              Page moved
            </span>
          )}
        </a>
      )}
      {archiveUrl && (
        <a
          href={archiveUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-sm bg-seal-subtle px-2 py-1 text-[12px] text-seal hover:opacity-80 transition-opacity"
          title={archiveFingerprint ? `Snapshot ${archiveFingerprint.slice(0, 16)}...` : undefined}
        >
          <span className="font-medium">Archived copy</span>
          {archiveFingerprint && (
            <span className="fingerprint text-seal text-[11px]">
              {archiveFingerprint.slice(0, 8)}
            </span>
          )}
          <Download className="h-3 w-3 shrink-0" strokeWidth={1.75} />
        </a>
      )}
    </div>
  );
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 40 ? `${u.pathname.slice(0, 20)}…${u.pathname.slice(-16)}` : u.pathname;
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}
