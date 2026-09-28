"use client";

import { useMemo, useState } from "react";
import { ruleClientKey, sentRuleClientKeys } from "@/lib/current-assessments";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Impact } from "@/lib/argus-types";
import type { PolicyEventImpactsResponse } from "@/lib/types/policy-events";
import { queryKeys, useBriefs, useImpacts } from "@/lib/queries";
import { humanizeTopic } from "@/lib/humanize";
import { formatDelta, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/argus/page-header";
import { DataTable, type Column } from "@/components/argus/data-table";
import { FilterBar } from "@/components/argus/filter-bar";
import { StatusBadge } from "@/components/argus/status-badge";
import { ClientChip } from "@/components/argus/client-chip";
import { Fingerprint } from "@/components/argus/fingerprint";
import { InlineError } from "@/components/argus/inline-error";
import { ProgressLine } from "@/components/argus/progress-line";
import { EmptyState } from "@/components/empty-state";

type AssessmentStatus = "action-required" | "corrected" | "done" | "no-impact";
type Filter = "all" | AssessmentStatus;

type Row = Impact & { status: AssessmentStatus; title: string };

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "action-required", label: "Action required" },
  { value: "corrected", label: "Corrected" },
  { value: "done", label: "Done" },
  { value: "no-impact", label: "No impact" },
];

/**
 * Every stored assessment is signed, so the status column shows what the
 * consultant still has to do. A correction wins over everything else.
 */
/** Keys are (rule, client), so a brief or correction on any run of the rule counts. */
function deriveStatus(i: Impact, sentKeys: ReadonlySet<string>, correctedKeys: ReadonlySet<string>): AssessmentStatus {
  const key = ruleClientKey(i);
  if (correctedKeys.has(key)) return "corrected";
  if (!i.isAffected) return "no-impact";
  return sentKeys.has(key) ? "done" : "action-required";
}

/** Primitives only, so the combined result stays stable between renders. */
function combineCorrections(results: Array<UseQueryResult<PolicyEventImpactsResponse>>) {
  const keys: string[] = [];
  for (const q of results) {
    for (const c of q.data?.clients ?? []) {
      if (c.correctionsFiled > 0) keys.push(c.assessmentKey);
      for (const p of c.priorAssessments) if (p.correctionsFiled > 0) keys.push(p.assessmentKey);
    }
  }
  return { pending: results.some((q) => q.isPending), keys: keys.sort().join("\n") };
}

const COLUMNS: Column<Row>[] = [
  {
    key: "title",
    header: "Change",
    cell: (r) => <span className="font-medium text-ink-1">{r.title}</span>,
  },
  {
    key: "client",
    header: "Client",
    cell: (r) => <ClientChip clientId={r.clientId} />,
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => <StatusBadge kind="assessment" status={r.status} />,
  },
  {
    key: "delta",
    header: "CRS delta",
    align: "right",
    cell: (r) => (
      <span className="font-mono text-[12px] tabular whitespace-nowrap text-ink-1">
        {r.numericDelta === null || r.impactType === "none" ? (
          <span className="text-ink-3">n/a</span>
        ) : (
          formatDelta(r.numericDelta)
        )}
      </span>
    ),
  },
  {
    key: "fingerprint",
    header: "Signature",
    cell: (r) =>
      r.canonicalHash ? (
        <Fingerprint hash={r.canonicalHash} signed={!!r.signatureAlgorithm} chars={8} />
      ) : (
        <span className="font-mono text-[12px] text-ink-3">n/a</span>
      ),
  },
  {
    key: "when",
    header: "Signed",
    align: "right",
    cell: (r) => (
      <time dateTime={r.timestamp} className="font-mono text-[12px] tabular whitespace-nowrap text-ink-2">
        {formatRelative(r.timestamp)}
      </time>
    ),
  },
];

export default function ImpactsPage() {
  const impacts = useImpacts();
  const briefs = useBriefs();
  const all = useMemo(() => impacts.data?.impacts ?? [], [impacts.data]);

  // Corrections aren't on the assessment row. The per-event endpoint joins them,
  // and the event screen reads the same cache. Events are keyed by rule, and
  // each response covers every run of that rule through priorAssessments.
  const eventIds = useMemo(() => Array.from(new Set(all.map((i) => i.ruleHash || i.policyEventId))), [all]);
  const corrections = useQueries({
    queries: eventIds.map((id) => ({
      queryKey: queryKeys.policyEventImpacts(id),
      queryFn: () => api<PolicyEventImpactsResponse>(`/policy-events/${encodeURIComponent(id)}/impacts`),
    })),
    combine: combineCorrections,
  });
  // Corrections come back per assessmentKey (any run). Map them to (rule, client).
  const correctedKeys = useMemo(() => {
    const byAssessment = new Map((impacts.data?.allImpacts ?? []).map((i) => [i.assessmentKey, ruleClientKey(i)]));
    const keys = corrections.keys ? corrections.keys.split("\n") : [];
    return new Set(keys.map((k) => byAssessment.get(k)).filter((k): k is string => Boolean(k)));
  }, [corrections.keys, impacts.data]);

  const rowsAll = useMemo<Row[]>(() => {
    const sent = sentRuleClientKeys(briefs.data?.briefs ?? []);
    return all.map((i) => ({ ...i, status: deriveStatus(i, sent, correctedKeys), title: humanizeTopic(i.topic) }));
  }, [all, briefs.data, correctedKeys]);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rowsAll.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!term) return true;
      return (
        r.clientId.toLowerCase().includes(term) ||
        r.title.toLowerCase().includes(term) ||
        r.topic.toLowerCase().includes(term) ||
        (r.narrative ?? "").toLowerCase().includes(term)
      );
    });
  }, [rowsAll, filter, search]);

  const loading = impacts.isPending || briefs.isPending || corrections.pending;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rowsAll.length, "action-required": 0, corrected: 0, done: 0, "no-impact": 0 };
    for (const r of rowsAll) c[r.status] += 1;
    return c;
  }, [rowsAll]);

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

  if (impacts.data && all.length === 0) {
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

  return (
    <div className="space-y-6">
      <ProgressLine active={loading} fixed label="Loading assessments" />
      {header}

      <div>
        <FilterBar
          className="border border-b-0 border-hairline"
          search={search}
          onSearchChange={setSearch}
          searchLabel="Search assessments"
          searchPlaceholder="Search client, change, wording"
          filters={FILTERS.map((f) => ({
            value: f.value,
            label: loading ? f.label : `${f.label} ${counts[f.value]}`,
          }))}
          filter={filter}
          onFilterChange={(v) => setFilter(v as Filter)}
          filterLabel="Filter by status"
          count={loading ? undefined : `${rows.length} of ${rowsAll.length}`}
        />
        <DataTable
          caption="Signed assessments"
          columns={COLUMNS}
          rows={rows}
          getRowKey={(r) => r.assessmentKey}
          rowHref={(r) => `/impacts/${encodeURIComponent(r.assessmentKey)}`}
          rowLinkLabel={(r) => `${r.title} for ${r.clientId}`}
          loading={loading}
          empty="Nothing matches. Change the filter or clear the search."
        />
      </div>
    </div>
  );
}
