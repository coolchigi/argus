"use client";

import { use, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLiveRun } from "@/components/agent-lineage";
import { EventDetail } from "@/components/policy-events/event-detail";
import { latestRunId } from "@/lib/lineage";
import { isNotFound, queryKeys, usePolicyEvent, usePolicyEventImpacts, useRunLineage } from "@/lib/queries";

function decode(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export default function PolicyEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const eventId = decode(id);
  const event = usePolicyEvent(eventId);
  const impacts = usePolicyEventImpacts(eventId);
  const runId = useMemo(() => latestRunId(impacts.data?.clients ?? []), [impacts.data]);
  const lineage = useRunLineage(runId);
  const live = useLiveRun(runId, lineage.data);

  // While a run is live, each newly signed assessment reloads the event and
  // its client table, so they fill in alongside the chips.
  const qc = useQueryClient();
  const signed = lineage.data?.agents.find((a) => a.agent === "anchor")?.count ?? 0;
  const lastSigned = useRef(signed);
  useEffect(() => {
    if (!live || signed === lastSigned.current) return;
    lastSigned.current = signed;
    void qc.invalidateQueries({ queryKey: queryKeys.policyEvent(eventId) });
    void qc.invalidateQueries({ queryKey: queryKeys.policyEventImpacts(eventId) });
  }, [live, signed, eventId, qc]);

  return (
    <EventDetail
      event={{
        data: event.data,
        loading: event.isFetching,
        error: event.error,
        notFound: isNotFound(event.error),
        retrying: event.isFetching,
        onRetry: () => void event.refetch(),
      }}
      impacts={{
        data: impacts.data,
        loading: impacts.isFetching,
        error: impacts.error,
        notFound: isNotFound(impacts.error),
        retrying: impacts.isFetching,
        onRetry: () => void impacts.refetch(),
      }}
      lineage={runId ? { policyEventId: runId, data: lineage.data, live } : undefined}
    />
  );
}
