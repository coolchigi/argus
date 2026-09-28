import { ClientChip } from "@/components/argus/client-chip";
import type { AggregatedAction } from "@/components/policy-events/derive";

/** §4. Recommended actions across affected clients, de-duplicated, most clients first. */
export function RecommendedActions({ actions }: { actions: AggregatedAction[] }) {
  if (actions.length === 0) {
    return <p className="text-[13px] text-ink-2">No actions needed. None of your clients are affected by this change.</p>;
  }
  return (
    <ol className="border border-hairline bg-card">
      {actions.map((a, i) => (
        <li key={a.action} className="flex gap-3 border-b border-hairline px-4 py-3 last:border-0">
          <span aria-hidden className="w-5 shrink-0 pt-0.5 font-mono text-[11px] text-ink-3">
            {i + 1}.
          </span>
          <div className="min-w-0 space-y-2">
            <p className="text-[13px] leading-snug text-ink-1">
              {a.action}
              <span className="ml-2 font-mono text-[11px] text-ink-3 whitespace-nowrap">
                · {a.clientIds.length} {a.clientIds.length === 1 ? "client" : "clients"}
              </span>
            </p>
            <ul className="flex flex-wrap gap-1.5" aria-label={`Clients for: ${a.action}`}>
              {a.clientIds.map((id) => (
                <li key={id}>
                  <ClientChip clientId={id} className="whitespace-nowrap" />
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}
