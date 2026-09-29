"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AgentLineage } from "@/components/agent-lineage";
import { Fingerprint } from "@/components/argus/fingerprint";
import { InlineError } from "@/components/argus/inline-error";
import { NumberedSection } from "@/components/argus/numbered-section";
import { ProgressLine } from "@/components/argus/progress-line";
import { StatusBadge } from "@/components/argus/status-badge";
import { Switch } from "@/components/argus/switch";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { EmptyState } from "@/components/empty-state";
import { useBreadcrumbLabel } from "@/components/nav/breadcrumb-context";
import { ClientImpactTable } from "@/components/policy-events/client-impact-table";
import { DeltaSummary } from "@/components/policy-events/delta-summary";
import {
  aggregateActions,
  deltaSummary,
  signedRows,
  visibleClients,
  type SignatureMaterial,
} from "@/components/policy-events/derive";
import { RecommendedActions } from "@/components/policy-events/recommended-actions";
import { SignedRecords } from "@/components/policy-events/signed-records";
import { SourceCitation } from "@/components/policy-events/source-citation";
import { humanizeCategory, humanizeOrigin, humanizePolicyDomain, humanizeTopic } from "@/lib/humanize";
import type { PolicyEventDetailResponse, PolicyEventImpactsResponse } from "@/lib/types/policy-events";
import type { Lineage } from "@/lib/types/lineage";

export type QueryState<T> = {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  notFound: boolean;
  retrying?: boolean;
  onRetry?: () => void;
};

function BackLink() {
  return (
    <Link href="/policy-events" className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink-1">
      <ArrowLeft aria-hidden className="h-3 w-3" strokeWidth={1.75} />
      All policy events
    </Link>
  );
}

function Placeholder({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden className="space-y-2.5 border border-hairline bg-card p-4">
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="block h-2.5 rounded-sm bg-hairline" style={{ width: `${90 - i * 18}%` }} />
      ))}
    </div>
  );
}

/** The per-event page: header, then §1 to §5. Each section fails on its own. */
/** The latest pipeline run on this event, for the agent chain under the header. */
export type RunLineage = { policyEventId: string; data: Lineage | undefined; live: boolean };

export function EventDetail({
  event,
  impacts,
  fetchSignature,
  lineage,
}: {
  event: QueryState<PolicyEventDetailResponse>;
  impacts: QueryState<PolicyEventImpactsResponse>;
  fetchSignature?: (assessmentKey: string) => Promise<SignatureMaterial>;
  lineage?: RunLineage;
}) {
  const [showUnaffected, setShowUnaffected] = useState(false);
  const e = event.data?.event;
  useBreadcrumbLabel(e?.ref);

  const clients = useMemo(() => impacts.data?.clients ?? [], [impacts.data]);
  const derived = useMemo(() => {
    const signed = signedRows(clients);
    return {
      affected: clients.filter((c) => c.isAffected).length,
      // The ones the switch hides. An unaffected client that needs action always shows.
      unaffected: clients.length - visibleClients(clients, false).length,
      actions: aggregateActions(clients),
      delta: deltaSummary(clients),
      signed,
      unsigned: clients.length - signed.length,
    };
  }, [clients]);
  const shown = useMemo(() => visibleClients(clients, showUnaffected), [clients, showUnaffected]);

  const loading = event.loading || impacts.loading;

  if (event.notFound) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          headline="We couldn't find that policy event."
          body="The link might be wrong, or the event belongs to another account. Open it from the list instead."
          action={
            <Link
              href="/policy-events"
              className="inline-flex h-9 items-center rounded-sm border border-brand-ink bg-brand px-4 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
            >
              Go to policy events
            </Link>
          }
        />
      </div>
    );
  }

  if (event.error && !e) {
    return (
      <div className="space-y-6">
        <BackLink />
        <InlineError
          message="Couldn't load this policy event."
          detail={event.error.message}
          retrying={event.retrying}
          onRetry={event.onRetry}
        />
      </div>
    );
  }

  const impactsError = impacts.error && !impacts.notFound && !impacts.data;
  const impactsPending = !impacts.data && !impacts.error && !impacts.notFound;
  const impactsSectionError = impactsError ? (
    <InlineError
      message="Couldn't load the clients for this change."
      detail={impacts.error?.message}
      retrying={impacts.retrying}
      onRetry={impacts.onRetry}
    />
  ) : null;

  return (
    <div className="max-w-5xl space-y-8">
      <ProgressLine active={loading} fixed label="Loading policy event" />
      <BackLink />

      {e ? (
        <header className="space-y-2">
          <div className="font-mono text-[12px] text-brand-ink tabular">{e.ref}</div>
          <h1 className="font-display text-[28px] leading-tight text-ink-1">{humanizeTopic(e.topic)}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] text-ink-3">
            <StatusBadge kind="event" status={e.status} />
            {e.severity && (
              <span className="inline-flex items-center gap-1.5">
                <span className="sr-only">Severity</span>
                <StatusBadge kind="severity" status={e.severity} />
              </span>
            )}
            <span className="text-ink-2">{humanizePolicyDomain(e.policyDomain)}</span>
            <span aria-hidden>·</span>
            <span>
              Detected{" "}
              <time dateTime={e.detectedAt} className="text-ink-2 tabular">
                {formatDayMonthYear(e.detectedAt)}
              </time>
            </span>
            <span aria-hidden>·</span>
            <span className="tabular">
              {e.affectedCount} of {e.assessedCount} clients affected
            </span>
            {e.awaitingBrief > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="text-brand-ink tabular">{e.awaitingBrief} awaiting a brief</span>
              </>
            )}
            {(e.auditorDisagrees ?? 0) > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="text-danger-ink tabular">
                  Auditor disagrees on {e.auditorDisagrees} {e.auditorDisagrees === 1 ? "client" : "clients"}
                </span>
              </>
            )}
            {(e.consultantReviewed ?? 0) > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular">{e.consultantReviewed} reviewed by you</span>
              </>
            )}
          </div>
        </header>
      ) : (
        <div aria-hidden className="space-y-3">
          <span className="block h-3 w-32 rounded-sm bg-hairline" />
          <span className="block h-6 w-2/3 rounded-sm bg-hairline" />
          <span className="block h-3 w-1/2 rounded-sm bg-hairline" />
        </div>
      )}

      {lineage && (
        <section aria-label="How Argus reviewed this change" className="space-y-2">
          <p className="label">{lineage.live ? "Reviewing now" : "Latest review"}</p>
          <AgentLineage policyEventId={lineage.policyEventId} lineage={lineage.data} live={lineage.live} scope="run" />
        </section>
      )}

      <NumberedSection number={1} title="Change summary">
        {e ? (
          <div className="space-y-4 border border-hairline bg-card p-5">
            <p className="max-w-[72ch] text-[14px] leading-relaxed text-ink-1">
              {e.summary ?? "Argus doesn't have a written summary for this change. Read the source below."}
            </p>
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <dt className="label mb-0.5">Category</dt>
                <dd className="text-[12px] text-ink-1">{humanizeCategory(e.category)}</dd>
              </div>
              <div>
                <dt className="label mb-0.5">Found by</dt>
                <dd className="text-[12px] text-ink-1">{humanizeOrigin(e.origin)}</dd>
              </div>
              <div>
                <dt className="label mb-0.5">Rule version</dt>
                <dd>
                  <Fingerprint hash={e.ruleHash} chars={12} />
                </dd>
              </div>
            </dl>
            {derived.delta && <DeltaSummary summary={derived.delta} />}
          </div>
        ) : (
          <Placeholder />
        )}
      </NumberedSection>

      <NumberedSection number={2} title="Source citation">
        {event.data ? <SourceCitation citation={event.data.citation} /> : <Placeholder lines={2} />}
      </NumberedSection>

      <NumberedSection
        number={3}
        title="Affected clients"
        actions={
          derived.unaffected > 0 ? (
            <Switch
              checked={showUnaffected}
              onCheckedChange={setShowUnaffected}
              label={<span className="text-[12px] text-ink-2">Show unaffected ({derived.unaffected})</span>}
              className="items-center gap-3"
            />
          ) : undefined
        }
      >
        {impactsSectionError ??
          (impactsPending ? (
            <Placeholder lines={4} />
          ) : (
            <div className="space-y-2">
              <p className="font-mono text-[11px] text-ink-3 tabular">
                {derived.affected} affected of {clients.length} assessed
              </p>
              <ClientImpactTable
                clients={shown}
                empty={
                  clients.length === 0
                    ? "No clients have been assessed against this change yet."
                    : "None of your clients are affected by this change."
                }
              />
            </div>
          ))}
      </NumberedSection>

      <NumberedSection number={4} title="Recommended actions">
        {impactsSectionError ?? (impactsPending ? <Placeholder /> : <RecommendedActions actions={derived.actions} />)}
      </NumberedSection>

      <NumberedSection number={5} title="Signed records">
        {impactsSectionError ??
          (impactsPending ? (
            <Placeholder lines={4} />
          ) : (
            <SignedRecords rows={derived.signed} unsignedCount={derived.unsigned} fetchSignature={fetchSignature} />
          ))}
      </NumberedSection>
    </div>
  );
}
