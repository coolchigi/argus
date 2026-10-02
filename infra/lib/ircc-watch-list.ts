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

// Not on the list: the newsroom (news.html), Ministerial Instructions, its
// Express Entry rounds page and the rounds-of-invitations page. They fill in
// their content in the browser, so the HTML Sentinel hashes never changes.
// Express Entry draws live in a JSON file those pages load, which needs its
// own handling before Sentinel can watch it.
export const IRCC_WATCH_LIST: readonly string[] = [
  // IRCC notices: program notices that aren't news releases.
  `${IRCC}/news/notices.html`,
  // Program delivery updates: changes to the instructions officers follow.
  `${IRCC}/corporate/publications-manuals/operational-bulletins-manuals/updates.html`,
  // Express Entry category-based selection (PolicyRules topic ee-category-based-selection).
  `${IRCC}/services/immigrate-canada/express-entry/rounds-invitations/category-based-selection.html`,
  // Express Entry: check your score.
  `${IRCC}/services/immigrate-canada/express-entry/check-score.html`,
  // Express Entry: the CRS criteria and points.
  `${IRCC}/services/immigrate-canada/express-entry/check-score/crs-criteria.html`,
  // Express Entry: who can apply.
  `${IRCC}/services/immigrate-canada/express-entry/who-can-apply.html`,
  // Express Entry: job offers.
  `${IRCC}/services/immigrate-canada/express-entry/documents/job-offer.html`,
  // Notice on arranged employment offers for the Federal Skilled Worker Program.
  `${IRCC}/news/notices/change-offers-arranged-employment-federal-skilled-worker-program.html`,
  // Study permits: provincial or territorial attestation letter (pal-tal-requirements).
  `${IRCC}/services/study-canada/study-permit/get-documents/provincial-attestation-letter.html`,
  // Study permits: eligibility.
  `${IRCC}/services/study-canada/study-permit/eligibility.html`,
  // Study permits: documents to submit.
  `${IRCC}/services/study-canada/study-permit/get-documents.html`,
  // Study permits: proof of financial support.
  `${IRCC}/services/study-canada/study-permit/get-documents/financial-support.html`,
  // Study permits: working off campus.
  `${IRCC}/services/study-canada/work/work-off-campus.html`,
  // Study permits: conditions while you study.
  `${IRCC}/services/study-canada/study-permit/while-you-study/study-permit-conditions.html`,
  // Post-graduation work permit: overview.
  `${IRCC}/services/study-canada/work/after-graduation.html`,
  // Post-graduation work permit: eligibility.
  `${IRCC}/services/study-canada/work/after-graduation/eligibility.html`,
  // Post-graduation work permit: field of study (field-of-study-requirement).
  `${IRCC}/services/study-canada/work/after-graduation/eligibility/field-of-study.html`,
  // Open work permits for spouses and dependent children.
  `${IRCC}/services/work-canada/special-instructions/spouses-dependent-children.html`,
  // Open work permits for spouses: eligibility (open-work-permit-eligibility, canonical URL).
  `${IRCC}/services/work-canada/special-instructions/spouses-dependent-children/eligibility.html`,
  // Provincial Nominee Program: overview.
  `${IRCC}/services/immigrate-canada/provincial-nominees.html`,
  // Provincial nominees through Express Entry (pnp-express-entry).
  `${IRCC}/services/immigrate-canada/provincial-nominees/express-entry.html`,
  // Sponsor parents and grandparents: overview.
  `${IRCC}/services/immigrate-canada/family-sponsorship/sponsor-parents-grandparents.html`,
  // Sponsor parents and grandparents: eligibility.
  `${IRCC}/services/immigrate-canada/family-sponsorship/sponsor-parents-grandparents/eligibility.html`,
  // Parents and grandparents program notice (pgp-program-pause).
  `${IRCC}/news/notices/responsibly-manage-parent-grandparent-program.html`,
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
