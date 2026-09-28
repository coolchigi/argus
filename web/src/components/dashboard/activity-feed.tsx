import Link from "next/link";
import type { ReactNode } from "react";
import { ClientChip } from "@/components/argus/client-chip";
import { Fingerprint } from "@/components/argus/fingerprint";
import { formatFeedTime } from "@/components/dashboard/derive";
import type { ActivityItem, ActivityKind } from "@/lib/types/policy-events";
import { cn } from "@/lib/utils";

export const ACTIVITY_LIMIT = 8;

const KIND_LABEL: Record<ActivityKind, string> = {
  "assessment-signed": "Assessment signed",
  "brief-sent": "Brief sent",
  "correction-filed": "Correction filed",
  "alert-emailed": "Alert emailed",
};

/** Seal-green only for a signed assessment that carries its fingerprint. */
function dotClass(item: ActivityItem): string {
  if (item.kind === "assessment-signed" && item.fingerprint) return "bg-seal";
  if (item.kind === "correction-filed") return "bg-danger";
  if (item.kind === "alert-emailed") return "bg-brand";
  return "bg-ink-3";
}

function refHref(item: ActivityItem): string {
  const id = encodeURIComponent(item.ref.id);
  if (item.ref.kind === "assessment") return `/impacts/${id}`;
  if (item.ref.kind === "brief") return `/briefs/${id}`;
  return `/policy-events/${id}`;
}

function Placeholder() {
  return (
    <ol aria-hidden className="ml-2 border-l border-hairline">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="relative py-2.5 pl-4 pr-1">
          <span className="absolute left-0 top-[18px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-hairline" />
          <span className="block h-2.5 w-3/4 rounded-sm bg-hairline" />
          <span className="mt-2 block h-2 w-1/3 rounded-sm bg-hairline" />
        </li>
      ))}
    </ol>
  );
}

/** Audit activity as a left-rail timeline, newest first. */
export function ActivityFeed({
  items,
  loading,
  error,
}: {
  items: ActivityItem[];
  loading: boolean;
  /** Rendered in place of the feed when the request failed. */
  error?: ReactNode;
}) {
  return (
    <section aria-labelledby="activity-heading" className="min-w-0">
      <h2 id="activity-heading" className="label mb-2">
        Audit activity
      </h2>
      {error ?? (
        <div className="border border-hairline bg-card px-3 py-3">
          {loading ? (
            <Placeholder />
          ) : items.length === 0 ? (
            <p className="px-1 py-8 text-center text-[13px] text-ink-2">Nothing recorded yet.</p>
          ) : (
            <ol className="ml-2 border-l border-hairline">
              {items.map((item) => (
                <li key={item.id} className="relative py-2.5 pl-4 pr-1">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-0 top-[18px] h-1.5 w-1.5 -translate-x-1/2 rounded-full",
                      dotClass(item),
                    )}
                  />
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={refHref(item)}
                      className="min-w-0 text-[13px] leading-snug text-ink-1 underline-offset-4 hover:underline"
                    >
                      <span className="sr-only">{KIND_LABEL[item.kind]}: </span>
                      {item.title}
                    </Link>
                    <time dateTime={item.at} className="shrink-0 font-mono text-[11px] text-ink-3 tabular">
                      {formatFeedTime(item.at)}
                    </time>
                  </div>
                  {(item.clientId || (item.kind === "assessment-signed" && item.fingerprint)) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {item.clientId && <ClientChip clientId={item.clientId} />}
                      {item.kind === "assessment-signed" && item.fingerprint && (
                        <Fingerprint hash={item.fingerprint} signed chars={8} href={`/verify/${item.fingerprint}`} />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
