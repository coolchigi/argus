// The editable profile attributes, in display order, with the input each one
// takes. The add form, the edit form and the detail view all read this list.
//
// It mirrors OPTIONAL_FIELDS in services/profiles/src/validate.ts, which
// is the one that counts: the server validates every value again.
// profile-fields.test.ts fails when the two lists drift apart.
//
// `programs` only decides which inputs a form shows first. It's a layout
// choice and says nothing about eligibility. Any field with a value is shown
// whatever the program.

import {
  DLI_TYPES,
  PGP_SPONSOR_STATUSES,
  PR_PATHWAYS,
  type ClientProfile,
  type ClientProgram,
  type PatchProfileRequest,
} from "../../lib/types/profiles.ts";

export type EditableAttr = Exclude<keyof ClientProfile, "clientId" | "program" | "status" | "createdAt" | "updatedAt" | "closedAt">;

export type Option = { value: string; label: string };

export type FieldInput =
  | { kind: "int"; min: number; max: number }
  | { kind: "number"; min: number; max: number }
  | { kind: "bool" }
  | { kind: "enum"; options: readonly Option[] }
  | { kind: "date" }
  | { kind: "code"; pattern: string; placeholder: string };

export type ProfileField = {
  attr: EditableAttr;
  /** CSV column. */
  column: string;
  label: string;
  input: FieldInput;
  programs: readonly ClientProgram[];
  /** A lowercase slug the detail view shows as words ("college-diploma" as "College diploma"). */
  slug?: true;
};

const PGP_SPONSOR_LABELS: Record<(typeof PGP_SPONSOR_STATUSES)[number], string> = {
  "no-interest-form": "No interest to sponsor form",
  "interest-form-submitted": "Interest form submitted, not invited",
  "invited-to-apply": "Invited to apply",
  "application-submitted": "Application submitted",
};

const DLI_LABELS: Record<(typeof DLI_TYPES)[number], string> = {
  public: "Public",
  private: "Private",
};

const PR_PATHWAY_LABELS: Record<(typeof PR_PATHWAYS)[number], string> = {
  none: "None",
  "express-entry": "Express Entry",
  pnp: "Provincial nominee",
  quebec: "Quebec",
  atlantic: "Atlantic",
  "other-economic": "Other economic",
  family: "Family",
  other: "Other",
};

function options<T extends string>(values: readonly T[], labels: Record<T, string>): Option[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const EE: ClientProgram[] = ["express-entry", "pnp"];
const TEER = { kind: "int", min: 0, max: 5 } as const;
const CLB = { kind: "int", min: 0, max: 12 } as const;
const YEARS = { kind: "number", min: 0, max: 80 } as const;
const SLUG = { kind: "code", pattern: "[a-z0-9][a-z0-9\\-]{0,39}", placeholder: "master" } as const;

export const PROFILE_FIELDS: readonly ProfileField[] = [
  { attr: "currentCrsScore", column: "current_crs_score", label: "CRS score", input: { kind: "int", min: 0, max: 9999 }, programs: EE },
  { attr: "nocCode", column: "noc_code", label: "NOC", input: { kind: "code", pattern: "\\d{5}", placeholder: "21231" }, programs: EE },
  { attr: "teerLevel", column: "teer_level", label: "TEER", input: TEER, programs: EE },
  { attr: "educationLevel", column: "education_level", label: "Education", input: SLUG, programs: [...EE, "pgwp"], slug: true },
  { attr: "clbEnglishWorst", column: "clb_english_worst", label: "CLB English, lowest", input: CLB, programs: EE },
  { attr: "clbFrenchWorst", column: "clb_french_worst", label: "CLB French, lowest", input: CLB, programs: EE },
  { attr: "canadianWorkYears", column: "canadian_work_years", label: "Canadian work, years", input: YEARS, programs: EE },
  { attr: "foreignWorkYears", column: "foreign_work_years", label: "Foreign work, years", input: YEARS, programs: EE },
  { attr: "hasJobOffer", column: "has_job_offer", label: "Job offer", input: { kind: "bool" }, programs: EE },
  { attr: "jobOfferTeer", column: "job_offer_teer", label: "Job offer TEER", input: TEER, programs: EE },
  { attr: "principalPermitTeer", column: "principal_permit_teer", label: "Principal permit TEER", input: TEER, programs: ["sowp"] },
  {
    attr: "principalPermitRemainingMonths",
    column: "principal_permit_remaining_months",
    label: "Principal permit, months left",
    input: { kind: "int", min: 0, max: 600 },
    programs: ["sowp"],
  },
  {
    attr: "principalPrPathway",
    column: "principal_pr_pathway",
    label: "Principal PR pathway",
    input: { kind: "enum", options: options(PR_PATHWAYS, PR_PATHWAY_LABELS) },
    programs: ["sowp"],
  },
  { attr: "principalPrApplied", column: "principal_pr_applied", label: "Principal applied for PR", input: { kind: "bool" }, programs: ["sowp"] },
  { attr: "cipCode", column: "cip_code", label: "CIP code", input: { kind: "code", pattern: "\\d{2}\\.\\d{4}", placeholder: "52.0201" }, programs: ["pgwp"] },
  { attr: "graduationDate", column: "graduation_date", label: "Graduation", input: { kind: "date" }, programs: ["pgwp"] },
  {
    attr: "studyPermitAppliedDate",
    column: "study_permit_applied_date",
    label: "Study permit applied",
    input: { kind: "date" },
    programs: ["pgwp", "study-permit"],
  },
  { attr: "intendedStudyLevel", column: "intended_study_level", label: "Intended study level", input: SLUG, programs: ["study-permit"], slug: true },
  {
    attr: "dliType",
    column: "dli_type",
    label: "DLI type",
    input: { kind: "enum", options: options(DLI_TYPES, DLI_LABELS) },
    programs: ["study-permit"],
  },
  { attr: "studyStartDate", column: "study_start_date", label: "Study start", input: { kind: "date" }, programs: ["study-permit"] },
  { attr: "palOnFile", column: "pal_on_file", label: "PAL on file", input: { kind: "bool" }, programs: ["study-permit"] },
  {
    attr: "pgpSponsorStatus",
    column: "pgp_sponsor_status",
    label: "PGP sponsor status",
    input: { kind: "enum", options: options(PGP_SPONSOR_STATUSES, PGP_SPONSOR_LABELS) },
    programs: ["pgp"],
  },
  { attr: "pgpSponsor2020Form", column: "pgp_sponsor_2020_form", label: "2020 PGP interest form", input: { kind: "bool" }, programs: ["pgp"] },
  { attr: "pgpLicoYearsMet", column: "pgp_lico_years_met", label: "LICO years met", input: { kind: "int", min: 0, max: 99 }, programs: ["pgp"] },
  { attr: "pnpProvince", column: "pnp_province", label: "PNP province", input: { kind: "code", pattern: "[A-Z]{2}", placeholder: "ON" }, programs: ["pnp"] },
];

/** The fields added so the Auditor can decide PGP, study permit, PGWP and spousal permit cases. The add form offers these for the chosen program. */
export const ADD_FORM_ATTRS: readonly EditableAttr[] = [
  "pgpSponsorStatus",
  "dliType",
  "studyStartDate",
  "studyPermitAppliedDate",
  "principalPrPathway",
  "principalPrApplied",
];

const CROSS_PROGRAM: readonly ClientProgram[] = ["general", "other"];

/** Fields a form shows for this program, plus any the profile already has a value for. general and other show everything. */
export function fieldsFor(program: ClientProgram | undefined, profile: Partial<ClientProfile> = {}): ProfileField[] {
  return PROFILE_FIELDS.filter(
    (f) => !program || CROSS_PROGRAM.includes(program) || f.programs.includes(program) || hasValue(profile[f.attr]),
  );
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/** The profile value as the form holds it. Booleans become "true" or "false", missing becomes "". */
export function toDraft(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

export type Formatters = { date: (iso: string) => string; slug: (s: string) => string };

/** Label for the detail view. */
export function formatValue(field: ProfileField, v: unknown, fmt: Formatters): string {
  if (field.slug) return fmt.slug(String(v));
  switch (field.input.kind) {
    case "bool":
      return v === true ? "Yes" : v === false ? "No" : String(v);
    case "enum":
      return field.input.options.find((o) => o.value === v)?.label ?? String(v);
    case "date":
      return fmt.date(`${String(v)}T12:00:00Z`);
    default:
      return String(v);
  }
}

/** Form text to the JSON value the API takes. Blank means "not set". Anything the server should judge is passed through as typed. */
export function fromDraft(field: ProfileField, draft: string): unknown {
  const s = draft.trim();
  if (s === "") return null;
  switch (field.input.kind) {
    case "int":
    case "number": {
      const n = Number(s);
      return Number.isFinite(n) ? n : s;
    }
    case "bool":
      return s === "true" ? true : s === "false" ? false : s;
    default:
      return s;
  }
}

/**
 * PATCH body from the edited drafts. Only fields whose value changed go in.
 * A field that had a value and is now blank is sent as null, which clears it.
 */
export function buildPatch(fields: readonly ProfileField[], profile: Partial<ClientProfile>, drafts: Partial<Record<EditableAttr, string>>): PatchProfileRequest {
  const body: PatchProfileRequest = {};
  for (const f of fields) {
    const draft = drafts[f.attr];
    if (draft === undefined) continue;
    const next = fromDraft(f, draft);
    const prev = profile[f.attr];
    if (next === null ? !hasValue(prev) : next === prev) continue;
    body[f.attr] = next;
  }
  return body;
}

/** Raw values (codes, numbers) read best in the mono face. Words don't. */
export function isMono(field: ProfileField): boolean {
  return !field.slug && field.input.kind !== "bool" && field.input.kind !== "enum" && field.input.kind !== "date";
}
