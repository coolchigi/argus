"use client";

import { EventsList } from "@/components/policy-events/events-list";
import { POLICY_EVENTS_MAX_LIMIT, usePolicyEvents } from "@/lib/queries";

export default function PolicyEventsPage() {
  // Same params as the sidebar badge and the dashboard, so they share one cached response.
  const events = usePolicyEvents({ limit: POLICY_EVENTS_MAX_LIMIT });
  return (
    <EventsList
      data={events.data}
      loading={events.isFetching}
      error={events.error}
      retrying={events.isFetching}
      onRetry={() => void events.refetch()}
    />
  );
}
