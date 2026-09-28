import { ArrowUpRight, FileArchive } from "lucide-react";
import { Badge } from "@/components/argus/status-badge";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import type { PolicyEventCitation } from "@/lib/types/policy-events";

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * §2. The live IRCC page and the snapshot Argus archived when it read the
 * change. When the live page stops answering, the snapshot is what the
 * assessment was built on.
 */
export function SourceCitation({ citation }: { citation: PolicyEventCitation }) {
  const { sourceUrl, sourceIsLive, archiveUrl, capturedAt } = citation;
  if (!sourceUrl && !archiveUrl) {
    return <p className="text-[13px] text-ink-2">No source is recorded for this change.</p>;
  }
  return (
    <div className="space-y-3 border border-l-2 border-hairline border-l-brand bg-card p-4">
      {sourceUrl && (
        <div>
          <div className="label mb-1.5 flex items-center gap-2">
            Official IRCC source
            {!sourceIsLive && <Badge tone="brand">Page moved</Badge>}
          </div>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-start gap-1 break-all font-mono text-[12px] text-ink-1 underline decoration-hairline underline-offset-4 hover:decoration-ink-2"
          >
            {shortenUrl(sourceUrl)}
            <ArrowUpRight aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-ink-3" strokeWidth={1.75} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          {!sourceIsLive && (
            <p className="mt-1.5 text-[12px] text-ink-2">
              This page didn&rsquo;t load when we checked just now. The archived snapshot below is what Argus read.
            </p>
          )}
        </div>
      )}
      {archiveUrl && (
        <div className={sourceUrl ? "border-t border-hairline pt-3" : undefined}>
          <div className="label mb-1.5">Archived snapshot</div>
          <a
            href={archiveUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-control bg-surface px-3 text-[12px] text-ink-1 transition-colors hover:bg-sunk"
          >
            <FileArchive aria-hidden className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
            Open snapshot{capturedAt ? ` from ${formatDayMonthYear(capturedAt)}` : ""}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <p className="mt-1.5 text-[11px] text-ink-3">The snapshot link works for 7 days after this page loads.</p>
        </div>
      )}
    </div>
  );
}
