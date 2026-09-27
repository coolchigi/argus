"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Brief, Impact } from "@/lib/argus-types";
import type {
  ActivityResponse,
  PolicyEventDetailResponse,
  PolicyEventImpactsResponse,
  PolicyEventStatus,
  PolicyEventsListResponse,
} from "@/lib/types/policy-events";

/**
 * Query keys in one place. Screens that still build their own keys use the
 * same arrays, so the cache is shared either way.
 */
export const queryKeys = {
  impacts: () => ["impacts"] as const,
  impact: (assessmentKey: string) => ["impact", assessmentKey] as const,
  briefs: () => ["briefs"] as const,
  brief: (briefId: string) => ["brief", briefId] as const,
  policyEvents: (params: PolicyEventsParams = {}) => ["policy-events", params] as const,
  policyEvent: (eventId: string) => ["policy-event", eventId] as const,
  policyEventImpacts: (eventId: string) => ["policy-event-impacts", eventId] as const,
  activity: (params: ActivityParams = {}) => ["activity", params] as const,
};

export type PolicyEventsParams = {
  limit?: number;
  status?: PolicyEventStatus;
  domain?: string;
};

export type ActivityParams = {
  limit?: number;
  before?: string;
};

/**
 * The API's upper bound for /policy-events. The dashboard and the sidebar both
 * ask for this, so they share one cached response.
 */
export const POLICY_EVENTS_MAX_LIMIT = 200;

function toQueryString(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function useImpacts(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.impacts(),
    queryFn: () => api<{ impacts: Impact[] }>("/impacts"),
    enabled: options.enabled ?? true,
  });
}

export function useImpact(assessmentKey: string) {
  return useQuery({
    queryKey: queryKeys.impact(assessmentKey),
    queryFn: () => api<Impact>(`/impacts/${encodeURIComponent(assessmentKey)}`),
  });
}

export function useBriefs(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.briefs(),
    queryFn: () => api<{ briefs: Brief[] }>("/briefs"),
    enabled: options.enabled ?? true,
  });
}

export function useBrief(briefId: string) {
  return useQuery({
    queryKey: queryKeys.brief(briefId),
    queryFn: () => api<Brief>(`/briefs/${briefId}`),
  });
}

/** GET /policy-events. `totals` ignore the filters and the limit. */
export function usePolicyEvents(params: PolicyEventsParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.policyEvents(params),
    queryFn: () => api<PolicyEventsListResponse>(`/policy-events${toQueryString(params)}`),
    enabled: options.enabled ?? true,
  });
}

export function usePolicyEvent(eventId: string) {
  return useQuery({
    queryKey: queryKeys.policyEvent(eventId),
    queryFn: () => api<PolicyEventDetailResponse>(`/policy-events/${encodeURIComponent(eventId)}`),
  });
}

export function usePolicyEventImpacts(eventId: string) {
  return useQuery({
    queryKey: queryKeys.policyEventImpacts(eventId),
    queryFn: () => api<PolicyEventImpactsResponse>(`/policy-events/${encodeURIComponent(eventId)}/impacts`),
  });
}

/** GET /activity. Newest first. */
export function useActivity(params: ActivityParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.activity(params),
    queryFn: () => api<ActivityResponse>(`/activity${toQueryString(params)}`),
    enabled: options.enabled ?? true,
  });
}

/**
 * Affected assessments that don't have a sent brief yet. This is the number
 * behind the Assessments badge and, later, the Action required tab.
 */
export function countActionRequired(impacts: Impact[], briefs: Brief[]): number {
  const sent = new Set(briefs.filter((b) => b.status === "sent").map((b) => b.assessmentKey));
  return impacts.filter((i) => i.isAffected && !sent.has(i.assessmentKey)).length;
}

/** Returns null until both lists have loaded, so a badge never flashes a wrong number. */
export function useActionRequiredCount(options: { enabled?: boolean } = {}): number | null {
  const impacts = useImpacts(options);
  const briefs = useBriefs(options);
  if (!impacts.data || !briefs.data) return null;
  return countActionRequired(impacts.data.impacts ?? [], briefs.data.briefs ?? []);
}
