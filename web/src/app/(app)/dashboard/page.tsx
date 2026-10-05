"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/components/auth-context";
import { EmptyState } from "@/components/empty-state";
import { InlineError } from "@/components/argus/inline-error";
import { ProgressLine } from "@/components/argus/progress-line";
import { ActivityFeed, ACTIVITY_LIMIT } from "@/components/dashboard/activity-feed";
import { AlertBanner } from "@/components/dashboard/alert-banner";
import { dashboardStats } from "@/components/dashboard/derive";
import { RecentEventsTable } from "@/components/dashboard/recent-events-table";
import { StatRail } from "@/components/dashboard/stat-rail";
import { POLICY_EVENTS_MAX_LIMIT, useActivity, useBriefs, useImpacts, usePolicyEvents } from "@/lib/queries";

function errorDetail(err: unknown): string | null {
  return err instanceof Error ? err.message : null;
}

export default function DashboardPage() {
  const auth = useAuth();
  const givenName = auth.status === "authed" ? auth.claims.givenName?.trim() : undefined;

  // Same params as the sidebar badge, so this is one request for both.
  const events = usePolicyEvents({ limit: POLICY_EVENTS_MAX_LIMIT });
  const impacts = useImpacts();
  const briefs = useBriefs();
  const activity = useActivity({ limit: ACTIVITY_LIMIT });

  const now = useMemo(() => new Date(), []);
  const dateLine = now.toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const monthLabel = now.toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  const stats = useMemo(() => {
    if (!events.data || !impacts.data || !briefs.data) return null;
    return dashboardStats({
      events: events.data.events ?? [],
      detectedThisMonth: events.data.totals.detectedThisMonth,
      impacts: impacts.data.impacts ?? [],
      briefs: briefs.data.briefs ?? [],
    });
  }, [events.data, impacts.data, briefs.data]);

  const loading = events.isPending || impacts.isPending || briefs.isPending || activity.isPending;
  const statsError = events.error ?? impacts.error ?? briefs.error;
  // Events are derived from assessments, so an empty unfiltered list means no assessments yet.
  const noAssessments = events.data !== undefined && events.data.events.length === 0;

  const header = (
    <header className="space-y-1">
      <h1 className="font-display text-[28px] leading-tight text-ink-1">
        {givenName ? `Good to see you, ${givenName}.` : "Good to see you."}
      </h1>
      <p className="font-mono text-[11px] text-ink-3">{dateLine}</p>
    </header>
  );

  if (noAssessments) {
    return (
      <div className="space-y-8">
        {header}
        <EmptyState
          headline="Nothing to review yet."
          body="Argus is watching IRCC. Import your caseload so the next change gets checked against it."
          action={
            <Link
              href="/setup"
              className="inline-flex h-9 items-center rounded-sm border border-brand-ink bg-brand px-4 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
            >
              Import clients
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ProgressLine active={loading} fixed label="Loading your dashboard" />

      {events.data && <AlertBanner events={events.data.events} />}

      {header}

      {statsError ? (
        <InlineError
          message="Couldn't load your numbers."
          detail={errorDetail(statsError)}
          retrying={events.isFetching || impacts.isFetching || briefs.isFetching}
          onRetry={() => {
            if (events.error) void events.refetch();
            if (impacts.error) void impacts.refetch();
            if (briefs.error) void briefs.refetch();
          }}
        />
      ) : (
        <StatRail stats={stats} monthLabel={monthLabel} />
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {/* The column stretches to the activity feed, so the tour marks the table itself. */}
          <div data-tour="dashboard-events">
            <RecentEventsTable
              events={events.data?.events ?? []}
              loading={events.isPending}
              error={
                events.error ? (
                  <InlineError
                    message="Couldn't load recent policy events."
                    detail={errorDetail(events.error)}
                    retrying={events.isFetching}
                    onRetry={() => void events.refetch()}
                  />
                ) : undefined
              }
            />
          </div>
        </div>
        <div className="min-w-0">
          <ActivityFeed
            items={activity.data?.items ?? []}
            loading={activity.isPending}
            error={
              activity.error ? (
                <InlineError
                  message="Couldn't load audit activity."
                  detail={errorDetail(activity.error)}
                  retrying={activity.isFetching}
                  onRetry={() => void activity.refetch()}
                />
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
