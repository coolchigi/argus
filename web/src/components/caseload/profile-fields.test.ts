import { test } from "node:test";
import assert from "node:assert/strict";
import { OPTIONAL_FIELDS, checkColumns, validateRow } from "../../../../services/profiles/src/validate.ts";
import { OPTIONAL_COLUMNS, TEMPLATE_CSV, parseImport } from "./csv.ts";
import { PROFILE_FIELDS, buildPatch, fieldsFor, formatValue } from "./profile-fields.ts";

// The server's field table is the source of truth. These fail when a field is
// added on one side only, or an enum gains a value the form can't offer.

test("the form offers every attribute the server accepts and returns, with the same CSV column", () => {
  const server = Object.entries(OPTIONAL_FIELDS)
    .filter(([, f]) => !f.writeOnly)
    .map(([column, f]) => `${f.attr}:${column}`)
    .sort();
  assert.deepEqual(PROFILE_FIELDS.map((f) => `${f.attr}:${f.column}`).sort(), server);
});

test("the import accepts every column the server knows", () => {
  assert.deepEqual([...OPTIONAL_COLUMNS].sort(), Object.keys(OPTIONAL_FIELDS).sort());
});

test("the downloadable template passes the browser checks and every row passes the server's", () => {
  const parsed = parseImport(TEMPLATE_CSV);
  assert.ok(parsed.ok);
  assert.deepEqual(checkColumns(parsed.rows), { ok: true });
  for (const row of parsed.rows) {
    const res = validateRow(row);
    assert.ok(res.ok, `${row.client_id}: ${res.ok ? "" : res.errors.join(", ")}`);
  }
  assert.ok(parsed.columns.includes("dli_type") && parsed.columns.includes("principal_pr_pathway"));
});

test("enum options and input kinds match the server spec", () => {
  for (const f of PROFILE_FIELDS) {
    const spec = OPTIONAL_FIELDS[f.column].spec;
    if (spec.kind === "enum") {
      assert.equal(f.input.kind, "enum", f.attr);
      assert.deepEqual(f.input.kind === "enum" && f.input.options.map((o) => o.value), [...spec.values], f.attr);
    } else if (spec.kind === "pattern") {
      assert.equal(f.input.kind, "code", f.attr);
    } else {
      assert.equal(f.input.kind, spec.kind, f.attr);
    }
  }
});

test("a study permit form shows the DLI type and study start, and keeps a field that already has a value", () => {
  const attrs = fieldsFor("study-permit").map((f) => f.attr);
  assert.ok(attrs.includes("dliType") && attrs.includes("studyStartDate") && attrs.includes("studyPermitAppliedDate"));
  assert.ok(!attrs.includes("pgpSponsorStatus"));
  assert.ok(fieldsFor("study-permit", { currentCrsScore: 400 }).some((f) => f.attr === "currentCrsScore"));
  assert.equal(fieldsFor("general").length, PROFILE_FIELDS.length);
});

test("the patch carries only changed fields, parses numbers and booleans, and clears with null", () => {
  const profile = { dliType: "public" as const, studyStartDate: "2027-01-11", principalPrApplied: false, currentCrsScore: 400 };
  const body = buildPatch(PROFILE_FIELDS, profile, {
    dliType: "private",
    studyStartDate: "2027-01-11",
    principalPrApplied: "true",
    currentCrsScore: "",
    pgpLicoYearsMet: "3",
    cipCode: "",
  });
  assert.deepEqual(body, { dliType: "private", principalPrApplied: true, currentCrsScore: null, pgpLicoYearsMet: 3 });
});

test("the detail view shows enum labels and yes or no", () => {
  const field = (attr: string) => PROFILE_FIELDS.find((f) => f.attr === attr)!;
  const fmt = { date: (s: string) => s.slice(0, 10), slug: (s: string) => `words:${s}` };
  assert.equal(formatValue(field("pgpSponsorStatus"), "no-interest-form", fmt), "No interest to sponsor form");
  assert.equal(formatValue(field("dliType"), "public", fmt), "Public");
  assert.equal(formatValue(field("principalPrApplied"), false, fmt), "No");
  assert.equal(formatValue(field("studyPermitAppliedDate"), "2024-11-20", fmt), "2024-11-20");
  assert.equal(formatValue(field("educationLevel"), "college-diploma", fmt), "words:college-diploma");
  assert.equal(formatValue(field("cipCode"), "52.0201", fmt), "52.0201");
});
