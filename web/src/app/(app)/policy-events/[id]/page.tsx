"use client";

import { use } from "react";
import { EventDetail } from "@/components/policy-events/event-detail";
import { isNotFound, usePolicyEvent, usePolicyEventImpacts } from "@/lib/queries";

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
    />
  );
}
