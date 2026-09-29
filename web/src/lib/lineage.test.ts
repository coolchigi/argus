import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChain,
  chainProgress,
  describeOutcomes,
  detectedAtFromEventId,
  formatDuration,
  isCrossFamily,
  isLive,
  latestRunId,
  LIVE_WINDOW_MS,
  modelFamily,
  parseCorrectionKey,
  runOrigin,
} from "./lineage.ts";
import type { Lineage, LineageAgent } from "./types/lineage.ts";

const agent = (over: Partial<LineageAgent> & Pick<LineageAgent, "agent">): LineageAgent => ({
  modelId: `us.amazon.${over.agent}-v1:0`,
  durationMs: 1000,
  count: 1,
  outcomes: { ok: 1 },
  firstAt: "2026-09-29T12:00:00.000Z",
  lastAt: "2026-09-29T12:00:00.000Z",
  ...over,
});

const lineage = (agents: LineageAgent[], startedAt: string | null = "2026-09-29T12:00:00.000Z"): Lineage => ({
  scope: "assessment",
  policyEventId: "pe1",
  assessmentKey: "pe1#c1",
  startedAt,
  lastStepAt: startedAt,
  agents,
  fewShotCorrectionKeys: [],
});

describe("buildChain", () => {
  test("puts Sentinel first on a live change and fills steps by agent", () => {
    const chain = buildChain("1759147200000-ab12cd34", lineage([agent({ agent: "analyst", durationMs: 3100 })]));
    assert.deepEqual(chain.map((c) => c.name), ["Sentinel", "Analyst", "Auditor", "Anchor", "Composer"]);
    assert.equal(chain[1].step?.durationMs, 3100);
    assert.equal(chain[2].step, null);
  });

  test("puts Recall first on a replay, even before any step is recorded", () => {
    assert.equal(buildChain("recall-1cbb49854167", undefined)[0].name, "Recall");
  });

  test("puts Recall first when Recall recorded a step, whatever the id", () => {
    assert.equal(buildChain("pe1", lineage([agent({ agent: "recall" })]))[0].name, "Recall");
  });
});

describe("run origin and progress", () => {
  const perClient = ["analyst", "auditor", "anchor", "composer"] as const;
  const all = (head: "sentinel" | "recall" | null) =>
    lineage([...(head ? [agent({ agent: head })] : []), ...perClient.map((a) => agent({ agent: a }))]);

  test("a Sentinel run expects 5 steps and is done only when Sentinel landed too", () => {
    const id = "1759147200000-ab12cd34";
    assert.equal(runOrigin(id, undefined), "sentinel");
    const full = buildChain(id, all("sentinel"));
    assert.equal(full[0].name, "Sentinel");
    assert.deepEqual(chainProgress(full), { done: 5, total: 5, complete: true });
    assert.deepEqual(chainProgress(buildChain(id, all(null))), { done: 4, total: 5, complete: false });
  });

  test("a Recall replay expects Recall at the head, not Sentinel", () => {
    const id = "recall-1cbb49854167";
    assert.equal(runOrigin(id, undefined), "recall");
    const full = buildChain(id, all("recall"));
    assert.deepEqual(full.map((c) => c.agent), ["recall", ...perClient]);
    assert.deepEqual(chainProgress(full), { done: 5, total: 5, complete: true });
    assert.deepEqual(chainProgress(buildChain(id, all(null))), { done: 4, total: 5, complete: false });
  });

  test("a demo run is headed by the demo trigger, which isn't a step, so 4 of 4 is done", () => {
    const id = "demo-1759147200000-22222222";
    assert.equal(runOrigin(id, undefined), "demo");
    const chain = buildChain(id, all(null));
    assert.equal(chain[0].agent, "demo-trigger");
    assert.equal(chain[0].name, "Demo trigger");
    assert.equal(chain[0].expected, false);
    assert.ok(!chain.some((c) => c.agent === "sentinel" || c.agent === "recall"));
    assert.deepEqual(chainProgress(chain), { done: 4, total: 4, complete: true });
  });

  test("a demo run with Composer still out isn't done", () => {
    const partial = lineage(perClient.slice(0, 3).map((a) => agent({ agent: a })));
    assert.deepEqual(chainProgress(buildChain("demo-1759147200000-22222222", partial)), { done: 3, total: 4, complete: false });
  });

  test("a demo run starts its live window at the trigger time in its id", () => {
    const at = 1759147200000;
    assert.equal(detectedAtFromEventId(`demo-${at}-22222222`), at);
    assert.equal(isLive(`demo-${at}-22222222`, undefined, at + 60_000), true);
    assert.equal(isLive(`demo-${at}-22222222`, undefined, at + LIVE_WINDOW_MS), false);
  });
});

describe("isLive", () => {
  const detected = 1759147200000;
  const id = `${detected}-ab12cd34`;

  test("is live inside 10 minutes of detection and not after", () => {
    assert.equal(isLive(id, undefined, detected + 5_000), true);
    assert.equal(isLive(id, undefined, detected + LIVE_WINDOW_MS - 1), true);
    assert.equal(isLive(id, undefined, detected + LIVE_WINDOW_MS), false);
  });

  test("uses the first recorded step when the id carries no time", () => {
    const l = lineage([agent({ agent: "recall" })], "2026-09-29T12:00:00.000Z");
    const start = Date.parse("2026-09-29T12:00:00.000Z");
    assert.equal(isLive("recall-1cbb49854167", l, start + 60_000), true);
    assert.equal(isLive("recall-1cbb49854167", l, start + LIVE_WINDOW_MS + 1), false);
  });

  test("never treats a historical assessment with no telemetry as live", () => {
    assert.equal(isLive("pe-old", lineage([], null), Date.now()), false);
  });
});

describe("model families", () => {
  test("reads the family past the inference-profile region", () => {
    assert.equal(modelFamily("us.anthropic.claude-haiku-4-5-20251001-v1:0"), "anthropic");
    assert.equal(modelFamily("amazon.nova-pro-v1:0"), "amazon");
    assert.equal(modelFamily(null), null);
  });

  test("reports cross-family only from recorded models", () => {
    const withModels = (a: string, b: string) =>
      buildChain("pe1", lineage([agent({ agent: "analyst", modelId: a }), agent({ agent: "auditor", modelId: b })]));
    assert.equal(isCrossFamily(withModels("us.amazon.nova-pro-v1:0", "us.anthropic.claude-haiku-4-5-20251001-v1:0")), true);
    assert.equal(isCrossFamily(withModels("us.amazon.nova-pro-v1:0", "us.amazon.nova-lite-v1:0")), false);
    assert.equal(isCrossFamily(buildChain("pe1", undefined)), null);
  });
});

test("formatDuration", () => {
  assert.equal(formatDuration(400), "0.4s");
  assert.equal(formatDuration(12_345), "12.3s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(null), "");
});

test("describeOutcomes lists the biggest group first", () => {
  assert.equal(describeOutcomes({ "not-affected": 1, affected: 2 }), "2 affected, 1 not affected");
});

describe("parseCorrectionKey", () => {
  test("splits a real key into the corrected assessment and the time", () => {
    assert.deepEqual(parseCorrectionKey("1759147200000-ab12cd34#C-101#2026-09-29T12:00:00.000Z"), {
      assessmentKey: "1759147200000-ab12cd34#C-101",
      clientId: "C-101",
      correctedAt: "2026-09-29T12:00:00.000Z",
    });
  });

  test("keeps a # inside the client id", () => {
    assert.equal(parseCorrectionKey("pe1#C#7#2026-09-29T12:00:00.000Z")?.clientId, "C#7");
  });

  test("rejects keys that aren't in that shape", () => {
    assert.equal(parseCorrectionKey("pe1#2026-09-29T12:00:00.000Z"), null);
    assert.equal(parseCorrectionKey("pe1#c1#not-a-date"), null);
    assert.equal(parseCorrectionKey("nohash"), null);
  });
});

test("latestRunId picks the run of the newest signed assessment", () => {
  assert.equal(
    latestRunId([
      { assessmentKey: "e1#C1", signedAt: "2026-09-28T10:00:00Z" },
      { assessmentKey: "e2#C2", signedAt: "2026-09-29T10:00:00Z" },
    ]),
    "e2",
  );
  assert.equal(latestRunId([]), null);
});
