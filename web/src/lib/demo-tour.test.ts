import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaced, samePath, TOUR_STEPS, tourClient, tourPaths } from "./demo-tour.ts";
import type { PolicyEvent, PolicyEventImpact } from "./types/policy-events.ts";

const event = (eventId: string, topic: string, affectedCount: number) => ({ eventId, topic, affectedCount }) as PolicyEvent;
const client = (over: Partial<PolicyEventImpact>) =>
  ({ clientId: "c", assessmentKey: "k", isAffected: true, canonicalHash: "ab", recordKind: "agent", brief: null, ...over }) as PolicyEventImpact;

test("the tour follows the PAL/TAL event, an agent verdict and its brief", () => {
  const events = [event("e1", "pgp-program-pause", 2), event("e2", "pal-tal-requirements", 2)];
  const clients = [
    client({ clientId: "2026-031", assessmentKey: "review-1#2026-031", recordKind: "consultant-review", brief: { briefId: "b1" } as PolicyEventImpact["brief"] }),
    client({ clientId: "2026-032", assessmentKey: "demo-2#2026-032", canonicalHash: "f300", brief: { briefId: "b2" } as PolicyEventImpact["brief"] }),
  ];
  const paths = tourPaths(events, clients);
  assert.equal(paths["event-summary"], "/policy-events/e2");
  assert.equal(paths["impact-lineage"], "/impacts/demo-2%232026-032");
  assert.equal(paths["brief-preview"], "/briefs/b2");
  assert.equal(paths["verify-result"], "/verify/f300");
});

test("missing demo data sends each step to its list page", () => {
  const paths = tourPaths([], []);
  assert.deepEqual(
    TOUR_STEPS.map((s) => paths[s.target]),
    ["/dashboard", "/policy-events", "/policy-events", "/impacts", "/impacts", "/briefs", "/verify"],
  );
});

test("an unsigned or unaffected client is never the one the tour follows", () => {
  assert.equal(tourClient([client({ isAffected: false }), client({ canonicalHash: null })]), null);
});

test("paths match across encoding and a trailing slash", () => {
  assert.ok(samePath("/impacts/demo-2%232026-032", "/impacts/demo-2#2026-032/"));
  assert.ok(!samePath("/impacts/a", "/impacts/b"));
});

test("an element pushed below or above the screen isn't placed, so the tour scrolls back", () => {
  // Step 3 on the live site at 1440x900: the clients table ended up at 982 after a scroll.
  assert.equal(isPlaced(982, 900), false);
  assert.equal(isPlaced(-120, 900), false);
  assert.ok(isPlaced(295, 900));
  assert.ok(isPlaced(66, 812));
});
