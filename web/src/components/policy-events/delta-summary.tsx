import type { DeltaSummary as Summary } from "@/components/policy-events/derive";
import { formatDelta } from "@/lib/format";

/** CRS point changes across affected clients. Rendered only when at least one client has a number. */
export function DeltaSummary({ summary }: { summary: Summary }) {
  const range = summary.min === summary.max ? formatDelta(summary.min) : `${formatDelta(summary.min)} to ${formatDelta(summary.max)}`;
  return (
    <dl className="grid grid-cols-1 gap-4 border-t border-hairline pt-4 sm:grid-cols-3">
      <Stat label="Clients with a CRS change" value={String(summary.count)} />
      <Stat label="Median change" value={formatDelta(summary.median)} />
      <Stat label="Range" value={range} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label mb-1">{label}</dt>
      <dd className="font-display text-[24px] leading-none text-ink-1 tabular">{value}</dd>
    </div>
  );
}
