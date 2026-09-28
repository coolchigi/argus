// CSV parsing and the whole-file checks for the caseload import.
//
// The column checks mirror services/profiles/src/validate.ts. They run here
// first so a file with an `email` or `first_name` column is refused before a
// single byte of it leaves the browser. The server runs the same checks again
// and is the one that counts.

import { looksLikeSinOrSsn } from "./client-id.ts";

export const MAX_IMPORT_ROWS = 500;

export const REQUIRED_COLUMNS = ["client_id", "program", "status", "consent_confirmed"] as const;

export const OPTIONAL_COLUMNS = [
  "age",
  "education_level",
  "clb_english_worst",
  "clb_french_worst",
  "canadian_work_years",
  "foreign_work_years",
  "noc_code",
  "teer_level",
  "has_job_offer",
  "job_offer_teer",
  "current_crs_score",
  "principal_permit_teer",
  "principal_permit_remaining_months",
  "cip_code",
  "graduation_date",
  "pgp_sponsor_2020_form",
  "pgp_lico_years_met",
  "pnp_province",
  "intended_study_level",
  "pal_on_file",
] as const;

export const FORBIDDEN_COLUMNS = [
  "name",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "address",
  "dob",
  "date_of_birth",
  "passport",
  "sin",
  "uci",
  "notes",
] as const;

const KNOWN = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);

/** "First Name" becomes first_name, same as the server. */
export function normalizeColumn(raw: string): string {
  return raw.replace(/^﻿/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * RFC 4180: quoted fields, doubled quotes inside quotes, commas and line
 * breaks inside quotes, CRLF or LF. Blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type ParsedImport =
  | { ok: true; columns: string[]; rows: Record<string, string>[] }
  | {
      ok: false;
      error: "empty" | "forbidden-column" | "unknown-column" | "missing-column" | "too-many-rows" | "sin-shaped-client-id";
      columns?: string[];
      count?: number;
      rows?: number[];
    };

/**
 * Parse and run the whole-file checks. Rows come back keyed by the
 * normalized column name, so the server sees one spelling.
 */
export function parseImport(text: string): ParsedImport {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, error: "empty" };
  const columns = table[0].map(normalizeColumn);

  const forbidden = columns.filter((c) => (FORBIDDEN_COLUMNS as readonly string[]).includes(c));
  if (forbidden.length > 0) return { ok: false, error: "forbidden-column", columns: [...new Set(forbidden)].sort() };
  const unknown = columns.filter((c) => c !== "" && !KNOWN.has(c));
  if (unknown.length > 0) return { ok: false, error: "unknown-column", columns: [...new Set(unknown)].sort() };
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) return { ok: false, error: "missing-column", columns: [...missing] };

  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) return { ok: false, error: "too-many-rows", count: body.length };

  const rows = body.map((cells) => {
    const r: Record<string, string> = {};
    columns.forEach((c, i) => {
      if (c && cells[i] !== undefined && cells[i].trim() !== "") r[c] = cells[i].trim();
    });
    // Required keys are always present, so a blank consent cell reads as unconfirmed.
    for (const c of REQUIRED_COLUMNS) r[c] ??= "";
    return r;
  });

  // A SIN-shaped case number could be a real SIN, so the whole file stays in
  // the browser. Row numbers count the header as row 1, like a spreadsheet.
  const sinShaped = rows.flatMap((r, i) => (looksLikeSinOrSsn(r.client_id) ? [i + 2] : []));
  if (sinShaped.length > 0) return { ok: false, error: "sin-shaped-client-id", rows: sinShaped };
  return { ok: true, columns, rows };
}

export const TEMPLATE_CSV = `${[...REQUIRED_COLUMNS, "current_crs_score", "noc_code", "teer_level"].join(",")}\n2026-001,express-entry,active,true,471,21231,1\n`;
