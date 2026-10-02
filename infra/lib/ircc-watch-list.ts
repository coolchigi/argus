// The canada.ca pages Sentinel checks every hour. This is the only copy of
// the list. CDK bakes it into the Sentinel bundle at synth time (esbuild
// `define`), because 30 URLs would overflow Lambda's 4 KB environment limit.
//
// Adding a URL is safe: the first time Sentinel sees a page it stores a
// baseline snapshot and emits nothing. A PolicyDelta only fires when a page
// changes after that.
//
// Every entry must be an https://www.canada.ca/ URL. Synth fails otherwise.

const IRCC = 'https://www.canada.ca/en/immigration-refugees-citizenship';

export const IRCC_WATCH_LIST: readonly string[] = [
  // IRCC newsroom: announcements land here first.
  `${IRCC}/news.html`,
  // Express Entry rounds of invitations: draw sizes and CRS cut-offs.
  `${IRCC}/services/immigrate-canada/express-entry/submit-profile/rounds-invitations.html`,
  // Ministerial instructions: the legal basis for draws and program caps.
  `${IRCC}/corporate/mandate/policies-operational-instructions-agreements/ministerial-instructions.html`,
  // CRS score check: how points are counted.
  `${IRCC}/services/immigrate-canada/express-entry/check-score.html`,
  // Parents and grandparents program notice (PolicyRules topic pgp-program-pause).
  `${IRCC}/news/notices/responsibly-manage-parent-grandparent-program.html`,
  // Provincial attestation letter for study permits (pal-tal-requirements).
  `${IRCC}/services/study-canada/study-permit/get-documents/provincial-attestation-letter.html`,
  // Express Entry category-based selection (ee-category-based-selection).
  `${IRCC}/services/immigrate-canada/express-entry/rounds-invitations/category-based-selection.html`,
  // Open work permit for spouses and dependent children (open-work-permit-eligibility).
  `${IRCC}/services/work-canada/permit/temporary/open-work-permit-spouses-dependent-children/eligibility.html`,
  // PGWP field-of-study requirement (field-of-study-requirement).
  `${IRCC}/services/study-canada/work/after-graduation/eligibility/field-of-study.html`,
  // Provincial nominees through Express Entry (pnp-express-entry).
  `${IRCC}/services/immigrate-canada/provincial-nominees/express-entry.html`,
];

/** Throws unless every entry is a unique https://www.canada.ca/ URL. */
export function assertValidWatchList(urls: readonly string[]): void {
  if (urls.length === 0) throw new Error('IRCC watch list is empty');
  const seen = new Set<string>();
  for (const u of urls) {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.canada.ca' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
      throw new Error(`IRCC watch list entry is not an https://www.canada.ca/ URL: ${u}`);
    }
    if (seen.has(u)) throw new Error(`IRCC watch list has a duplicate: ${u}`);
    seen.add(u);
  }
}
