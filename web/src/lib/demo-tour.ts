import type { PolicyEvent, PolicyEventImpact } from "./types/policy-events.ts";

// The guided tour for the read-only demo. It follows one real change through
// Argus: the PAL/TAL rule IRCC changed on 28 Sep, one affected client's
// signed assessment, its brief, and its public receipt. Each step points at a
// [data-tour] element on its page.

export const TOUR_TOPIC = "pal-tal-requirements";

export type TourTarget =
  | "dashboard-events"
  | "event-summary"
  | "event-clients"
  | "impact-lineage"
  | "impact-signature"
  | "brief-preview"
  | "verify-result";

export type TourStep = { target: TourTarget; title: string; body: string };

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: "dashboard-events",
    title: "IRCC changed a rule",
    body: "Argus checks 24 IRCC pages every hour. When a rule changes, it lands here with how many clients it affects. Next, the PAL/TAL change from 28 Sep.",
  },
  {
    target: "event-summary",
    title: "What changed",
    body: "Sentinel caught the change on the IRCC page and stored the new rule. The source link and its archived copy let anyone check it against IRCC.",
  },
  {
    target: "event-clients",
    title: "Who it affects",
    body: "The Analyst checked every client in the caseload against the new rule. Clients are file numbers only. Argus never stores a client's name.",
  },
  {
    target: "impact-lineage",
    title: "2 models check each other",
    body: "The Analyst (Amazon Nova Pro) wrote this verdict and the Auditor (Claude Haiku 4.5) reviewed it. They come from different model families on purpose. When they disagree, Argus flags it and the consultant decides.",
  },
  {
    target: "impact-signature",
    title: "Every finding is signed",
    body: "Anchor signed this assessment with an AWS KMS key (ECDSA P-256). Change one character of the record and the signature stops matching.",
  },
  {
    target: "brief-preview",
    title: "A draft for the client",
    body: "Composer drafts a brief from the signed assessment and cites the IRCC source. The consultant reviews it and sends it from their own email.",
  },
  {
    target: "verify-result",
    title: "Anyone can check it",
    body: "This public page checks the signature in the browser against Argus's pinned public key. A client or an auditor can open it with no login.",
  },
];

/** The page each step lives on. Falls back to the list page when the demo data doesn't have the record. */
export function tourPaths(events: PolicyEvent[] | undefined, clients: PolicyEventImpact[] | undefined): Record<TourTarget, string> {
  const event = tourEvent(events);
  const client = tourClient(clients);
  const eventPath = event ? `/policy-events/${encodeURIComponent(event.eventId)}` : "/policy-events";
  const impactPath = client ? `/impacts/${encodeURIComponent(client.assessmentKey)}` : "/impacts";
  return {
    "dashboard-events": "/dashboard",
    "event-summary": eventPath,
    "event-clients": eventPath,
    "impact-lineage": impactPath,
    "impact-signature": impactPath,
    "brief-preview": client?.brief ? `/briefs/${encodeURIComponent(client.brief.briefId)}` : "/briefs",
    "verify-result": client?.canonicalHash ? `/verify/${client.canonicalHash}` : "/verify",
  };
}

export function tourEvent(events: PolicyEvent[] | undefined): PolicyEvent | null {
  if (!events?.length) return null;
  return events.find((e) => e.topic === TOUR_TOPIC) ?? events.find((e) => e.affectedCount > 0) ?? null;
}

/**
 * The client the tour follows: affected, an agent verdict (so the Analyst and
 * Auditor show), signed, with a brief. Relaxes each wish in turn.
 */
export function tourClient(clients: PolicyEventImpact[] | undefined): PolicyEventImpact | null {
  const affected = (clients ?? []).filter((c) => c.isAffected && c.canonicalHash);
  const agent = affected.filter((c) => c.recordKind !== "consultant-review");
  return agent.find((c) => c.brief) ?? affected.find((c) => c.brief) ?? agent[0] ?? affected[0] ?? null;
}

/** Same path, ignoring encoding and a trailing slash. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let s = p.replace(/\/+$/, "") || "/";
    try {
      s = decodeURIComponent(s);
    } catch {
      // Keep it as given.
    }
    return s;
  };
  return norm(a) === norm(b);
}

// The tour puts an element centered or near the top, so a placed element's
// top lands in the upper part of the screen, clear of the card.
const PLACED_SHARE = 0.6;

/** The element's top is where the tour scrolled it: on screen, in the upper part. */
export function isPlaced(top: number, viewportHeight: number): boolean {
  return top >= 0 && top <= viewportHeight * PLACED_SHARE;
}
