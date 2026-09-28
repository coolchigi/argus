import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_IMPORT_ROWS, parseCsv, parseImport } from "./csv.ts";

const HEAD = "client_id,program,status,consent_confirmed";

test("parses quoted fields with commas, doubled quotes and line breaks", () => {
  const rows = parseCsv('a,b,c\r\n"x, y","he said ""hi""","line\nbreak"\n\n');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["x, y", 'he said "hi"', "line\nbreak"],
  ]);
});

test("refuses a file with a forbidden column before any row is read, whatever the header spelling", () => {
  const res = parseImport(`﻿${HEAD},Email,First Name\n2026-001,pgp,active,true,a@b.c,Jane\n`);
  assert.deepEqual(res, { ok: false, error: "forbidden-column", columns: ["email", "first_name"] });
});

test("refuses unknown columns so a renamed PII column can't slip through", () => {
  const res = parseImport(`${HEAD},client_name\n2026-001,pgp,active,true,Jane\n`);
  assert.deepEqual(res, { ok: false, error: "unknown-column", columns: ["client_name"] });
});

test("refuses a file over the row limit and accepts one at it", () => {
  const body = (n: number) => Array.from({ length: n }, (_, i) => `C-${i},pgp,active,true`).join("\n");
  assert.deepEqual(parseImport(`${HEAD}\n${body(MAX_IMPORT_ROWS + 1)}`), { ok: false, error: "too-many-rows", count: MAX_IMPORT_ROWS + 1 });
  const ok = parseImport(`${HEAD}\n${body(MAX_IMPORT_ROWS)}`);
  assert.ok(ok.ok && ok.rows.length === MAX_IMPORT_ROWS);
});

test("keys rows by normalized column and drops blank cells, keeping required keys", () => {
  const res = parseImport(`Client ID,Program,Status,Consent Confirmed,current_crs_score\n2026-001,pgp,active,,\n`);
  assert.ok(res.ok);
  assert.deepEqual(res.rows, [{ client_id: "2026-001", program: "pgp", status: "active", consent_confirmed: "" }]);
});
