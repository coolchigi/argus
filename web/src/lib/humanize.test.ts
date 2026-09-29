import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { humanizeOrigin, humanizeTopic } from "./humanize.ts";

describe("humanizeTopic", () => {
  // Every topic in the live PolicyRules table on 2026-09-29
  // (aws dynamodb scan --table-name argus-policy-rules --projection-expression topic).
  const live: Array<[string, string]> = [
    ["crs-scorecard-p5-test", "CRS scorecard P5 test"],
    ["crs-scorecheck", "CRS scorecheck"],
    ["ee-category-based-selection", "EE category-based selection"],
    ["field-of-study-requirement", "Field of study requirement"],
    ["ircc-newsroom", "IRCC newsroom"],
    ["open-work-permit-eligibility", "Open work permit eligibility"],
    ["pal-tal-requirements", "PAL/TAL requirements"],
    ["pgp-program-pause", "PGP program pause"],
    ["pnp-express-entry", "PNP Express Entry"],
  ];
  for (const [topic, label] of live) {
    test(`${topic} reads "${label}"`, () => assert.equal(humanizeTopic(topic), label));
  }

  test("uppercases every known acronym wherever it sits", () => {
    const ids = ["pal", "tal", "pgp", "pgwp", "sowp", "pnp", "ee", "crs", "noc", "teer", "lmia", "ircc", "dli", "sin", "cec", "fsw", "fst"];
    for (const id of ids) {
      assert.equal(humanizeTopic(id), id.toUpperCase());
      assert.equal(humanizeTopic(`new-${id}-rules`), `New ${id.toUpperCase()} rules`);
    }
  });

  test("joins only IRCC's paired acronyms with a slash", () => {
    assert.equal(humanizeTopic("clb-nclc-scores"), "CLB/NCLC scores");
    assert.equal(humanizeTopic("ee-crs-cutoff"), "EE CRS cutoff");
  });

  test("keeps the hyphen in a compound modifier and nowhere else", () => {
    assert.equal(humanizeTopic("dli-specific-caps"), "DLI-specific caps");
    assert.equal(humanizeTopic("study-permit-cap"), "Study permit cap");
  });

  test("uppercases the acronyms services/policy-events also knows", () => {
    assert.equal(humanizeTopic("pr-card-renewal"), "PR card renewal");
    assert.equal(humanizeTopic("eca-requirements"), "ECA requirements");
    assert.equal(humanizeTopic("cip-code-list"), "CIP code list");
  });

  test("humanizeOrigin names what sent the change in", () => {
    assert.equal(humanizeOrigin("sentinel"), "Sentinel");
    assert.equal(humanizeOrigin("recall"), "Recall replay");
    assert.equal(humanizeOrigin("demo"), "Demo trigger");
  });

  test("falls back when there's no topic", () => {
    assert.equal(humanizeTopic(""), "Untitled change");
    assert.equal(humanizeTopic(null), "Untitled change");
  });
});
