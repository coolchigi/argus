"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import type { Correction } from "@/lib/types/corrections";
import { POLICY_EVENTS_MAX_LIMIT, useBriefs, useCorrections, useImpacts, usePolicyEvents } from "@/lib/queries";
import {
  ACTION_REASON_LABEL,
  type AssessmentRail,
  type AssessmentRow,
  countActionRequired,
  deriveAssessmentRows,
  parseAssessmentTab,
} from "@/lib/assessments";
import { humanizeImpactType, humanizeTopic } from "@/lib/humanize";
import { formatDelta, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/argus/page-header";
import { FilterBar } from "@/components/argus/filter-bar";
import { Badge } from "@/components/argus/status-badge";
import { ClientChip } from "@/components/argus/client-chip";
import { Fingerprint } from "@/components/argus/fingerprint";
import { InlineError } from "@/components/argus/inline-error";
import { ProgressLine } from "@/components/argus/progress-line";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/argus/tabs";
import { EmptyState } from "@/components/empty-state";
import { CorrectionChange } from "@/components/assessments/correction-change";
import { cn } from "@/lib/utils";

const RAIL: Record<AssessmentRail, string> = {
  action: "bg-brand-ink",
  corrected: "bg-danger",
  done: "bg-ink-3",
  "no-impact": "bg-hairline",
};

export default function ImpactsPage() {
  // useSearchParams needs a Suspense boundary to build as a static page.
  return (
    <Suspense fallback={<ProgressLine active fixed label="Loading assessments" />}>
      <AssessmentsScreen />
    </Suspense>
  );
}

function AssessmentsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseAssessmentTab(searchParams.get("tab"));

  const impacts = useImpacts();
  const briefs = useBriefs();
  const corrections = useCorrections();
  // Same params as the sidebar and the dashboard, so it's one cached response.
  const events = usePolicyEvents({ limit: POLICY_EVENTS_MAX_LIMIT });

  const correctionList = useMemo(() => corrections.data?.corrections ?? [], [corrections.data]);
  const rows = useMemo(
    () => deriveAssessmentRows(impacts.data?.impacts ?? [], briefs.data?.briefs ?? [], correctionList),
    [impacts.data, briefs.data, correctionList],
  );
  const refs = useMemo(() => new Map((events.data?.events ?? []).map((e) => [e.eventId, e.ref])), [events.data]);

  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const matches = (r: AssessmentRow) =>
    !term ||
    r.clientId.toLowerCase().includes(term) ||
    humanizeTopic(r.topic).toLowerCase().includes(term) ||
    r.topic.toLowerCase().includes(term) ||
    (r.recommendedAction ?? "").toLowerCase().includes(term);

  const actionRows = rows.filter((r) => r.actionRequired);
  // The sidebar badge calls the same function, so the two can't disagree.
  const actionCount = useMemo(
    () => countActionRequired(impacts.data?.impacts ?? [], briefs.data?.briefs ?? []),
    [impacts.data, briefs.data],
  );
  const shown = (tab === "action" ? actionRows : rows).filter(matches);
  const shownCorrections = correctionList.filter(
    (c) => !term || c.clientId.toLowerCase().includes(term) || humanizeTopic(c.topic).toLowerCase().includes(term) || c.correctorReasoning.toLowerCase().includes(term),
  );

  // The Action required count needs briefs too, or a sent brief would still count.
  const rowsReady = !!impacts.data && !!briefs.data && !!corrections.data;
  const loading = impacts.isPending || briefs.isPending || corrections.isPending;

  function onTabChange(next: unknown) {
    const value = parseAssessmentTab(typeof next === "string" ? next : null);
    const qs = new URLSearchParams(searchParams.toString());
    if (value === "action") qs.delete("tab");
    else qs.set("tab", value);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  const header = (
    <PageHeader
      title="Assessments"
      meta="Reviewed by Analyst and Auditor from different model families, then signed by Anchor."
    />
  );

  if (impacts.error) {
    return (
      <div className="space-y-6">
        {header}
        <InlineError
          message="Couldn't load your assessments."
          detail={impacts.error instanceof Error ? impacts.error.message : null}
          retrying={impacts.isFetching}
          onRetry={() => void impacts.refetch()}
        />
      </div>
    );
  }

  if (impacts.data && (impacts.data.impacts ?? []).length === 0 && correctionList.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          headline="Nothing to review yet."
          body="Argus starts watching IRCC the moment your first client is imported. Assessments land here as soon as Sentinel sees a change."
        />
      </div>
    );
  }

  const count = (n: number) => (rowsReady ? <span className="font-mono text-[11px] tabular text-ink-3">{n}</span> : null);

  return (
    <div className="space-y-6">
      <ProgressLine active={loading} fixed label="Loading assessments" />
      {header}

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList aria-label="Assessment views">
          <Tab value="action">
            Action required {count(actionCount)}
          </Tab>
          <Tab value="all">All {count(rows.length)}</Tab>
          <Tab value="corrections">
            Corrections {corrections.data ? <span className="font-mono text-[11px] tabular text-ink-3">{correctionList.length}</span> : null}
          </Tab>
        </TabsList>

        <FilterBar
          className="mt-4 border border-hairline"
          search={search}
          onSearchChange={setSearch}
          searchLabel="Search assessments"
          searchPlaceholder="Search client, change, wording"
        />

        <TabsPanel value="action">
          {briefs.error ? <BriefsError onRetry={() => void briefs.refetch()} retrying={briefs.isFetching} /> : null}
          {rowsReady && actionRows.length === 0 ? (
            <EmptyState headline="All clear. Nothing's waiting on you." body="Every affected client has a brief sent or copied out, and no verdict is waiting on your review. New changes land here first." />
          ) : (
            <AssessmentList rows={shown} refs={refs} loading={!rowsReady} emptySearch={actionRows.length > 0} />
          )}
        </TabsPanel>

        <TabsPanel value="all">
          {briefs.error ? <BriefsError onRetry={() => void briefs.refetch()} retrying={briefs.isFetching} /> : null}
          <AssessmentList rows={shown} refs={refs} loading={!rowsReady} emptySearch={rows.length > 0} />
        </TabsPanel>

        <TabsPanel value="corrections">
          {corrections.error ? (
            <InlineError
              message="Couldn't load your corrections."
              detail={corrections.error instanceof Error ? corrections.error.message : null}
              retrying={corrections.isFetching}
              onRetry={() => void corrections.refetch()}
            />
          ) : corrections.data && correctionList.length === 0 ? (
            <EmptyState
              headline="No corrections yet."
              body="When an assessment reads wrong, open it and choose Correct this. Your reasoning shows up here and the Auditor learns from it."
            />
          ) : (
            <CorrectionList corrections={shownCorrections} loading={corrections.isPending} />
          )}
        </TabsPanel>
      </Tabs>
    </div>
  );
}

function BriefsError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <InlineError
      className="mb-4"
      message="Couldn't load your briefs, so Action required can't be worked out yet."
      retrying={retrying}
      onRetry={onRetry}
    />
  );
}

function AssessmentList({
  rows,
  refs,
  loading,
  emptySearch,
}: {
  rows: AssessmentRow[];
  refs: Map<string, string>;
  loading: boolean;
  emptySearch: boolean;
}) {
  if (loading) {
    return (
      <ul aria-hidden className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-[104px] border border-hairline bg-card" />
        ))}
      </ul>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-ink-2">
        {emptySearch ? "Nothing matches. Clear the search to see every assessment." : "No assessments here."}
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Assessments">
      {rows.map((r) => (
        <AssessmentCard key={r.assessmentKey} row={r} eventRef={refs.get(r.ruleHash || r.policyEventId) ?? null} />
      ))}
    </ul>
  );
}

function AssessmentCard({ row: r, eventRef }: { row: AssessmentRow; eventRef: string | null }) {
  const title = humanizeTopic(r.topic);
  const eventId = r.ruleHash || r.policyEventId;
  const showDelta = r.numericDelta !== null && r.impactType !== "none";
  return (
    <li className="relative border border-hairline bg-card transition-colors hover:bg-sunk/60 focus-within:bg-sunk/60">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", RAIL[r.rail])} />
      <div className="space-y-2 py-3 pl-5 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <ClientChip clientId={r.clientId} />
          <Link
            href={`/impacts/${encodeURIComponent(r.assessmentKey)}`}
            className="min-w-0 text-[14px] font-medium text-ink-1 underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
          >
            {title}
          </Link>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {r.actionReason && (
              <Badge tone={r.actionReason === "auditor-disagrees" ? "danger" : "brand"}>{ACTION_REASON_LABEL[r.actionReason]}</Badge>
            )}
            {r.reviewed && <Badge>Reviewed by you</Badge>}
            {r.corrected && <Badge tone="danger">Corrected</Badge>}
            {!r.actionRequired && !r.corrected && !r.reviewed && <Badge>{r.isAffected ? "Done" : "No impact"}</Badge>}
          </span>
        </div>
        <p className="text-[13px] text-ink-2">
          <span className="text-ink-1">{humanizeImpactType(r.impactType)}</span>
          {showDelta && <span className="ml-1.5 font-mono text-[12px] tabular text-ink-1">{formatDelta(r.numericDelta)}</span>}
          {r.recommendedAction ? <span className="block max-w-[80ch] pt-0.5 sm:inline sm:pl-2 sm:pt-0">{r.recommendedAction}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-3">
          {eventId && (
            <Link href={`/policy-events/${encodeURIComponent(eventId)}`} className="relative z-10 hover:text-ink-1 hover:underline underline-offset-4">
              {eventRef ?? "View event"}
            </Link>
          )}
          {r.canonicalHash && (
            <Fingerprint hash={r.canonicalHash} signed={!!r.signatureAlgorithm} chars={8} href={`/verify/${r.canonicalHash}`} className="relative z-10" />
          )}
          <time dateTime={r.timestamp} className="tabular">
            {r.reviewed ? "Reviewed" : "Signed"} {formatRelative(r.timestamp)}
          </time>
        </div>
      </div>
    </li>
  );
}

function CorrectionList({ corrections, loading }: { corrections: Correction[]; loading: boolean }) {
  if (loading) {
    return (
      <ul aria-hidden className="space-y-2">
        {[0, 1].map((i) => (
          <li key={i} className="h-[96px] border border-hairline bg-card" />
        ))}
      </ul>
    );
  }
  if (corrections.length === 0) {
    return <p className="py-10 text-center text-[13px] text-ink-2">Nothing matches. Clear the search to see every correction.</p>;
  }
  return (
    <ul className="space-y-2" aria-label="Corrections">
      {corrections.map((c) => (
        <li key={c.correctionKey} className="relative border border-hairline bg-card transition-colors hover:bg-sunk/60 focus-within:bg-sunk/60">
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-danger" />
          <div className="space-y-2 py-3 pl-5 pr-4">
            <div className="flex flex-wrap items-center gap-2">
              <ClientChip clientId={c.clientId} />
              <Link
                href={`/impacts/${encodeURIComponent(c.assessmentKey)}`}
                className="min-w-0 text-[14px] font-medium text-ink-1 underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
              >
                {humanizeTopic(c.topic)}
              </Link>
              <time dateTime={c.correctedAt} className="ml-auto font-mono text-[11px] tabular text-ink-3">
                Corrected {formatRelative(c.correctedAt)}
              </time>
            </div>
            <CorrectionChange c={c} />
            <p className="max-w-[80ch] text-[13px] leading-relaxed text-ink-1 line-clamp-3">{c.correctorReasoning}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
