// A brief is an email the consultant sends to their own client. It reads as
// the consultant talking to the client: "you", "your application", "I
// recommend". Two slips break that, and both showed up in live drafts:
// - "your client", which addresses the consultant instead of the client
// - the opaque client id, which is Argus bookkeeping and means nothing to the
//   reader (the web's "Copy for my email" adds a [CLIENT NAME] greeting)
// A third slip showed up once the first two were fixed: words for Argus's own
// steps. The Analyst writes "the rule does not confirm...", and a brief that
// repeats it tells the client "not confirmed by the rule", which means nothing
// to someone who has never seen the rule.
// A fourth came from brief 58366b94 (client 2026-032, 2026-09-30): "Your
// program starts on [start date]". The start date wasn't in Composer's inputs,
// so the model wrote a template slot, and the client would read it as is.
// A fifth came from brief 88d1df46 (client C-103, 2026-10-16): IRCC's "we'll pause
// invitation rounds", copied into an email the consultant signs.

export type VoiceFinding = 'your-client' | 'client-id' | 'internal-term' | 'placeholder' | 'agency-first-person';

const YOUR_CLIENT = /\byour\s+client(?:'s|s)?\b/i;
// "the rule" and "the assessment" as things the reader is meant to know
// about, plus Argus's own name and field names. "The rules for..." (plural)
// is ordinary English and passes.
const INTERNAL_TERM =
  /\b(?:the|this|that)\s+(?:rule|assessment|narrative)\b|\bargus\b|\b(?:impact\s?type|numeric\s?delta|rule\s?hash|confidence\s+(?:level|score))\b/i;

// Template slots a model writes when it lacks a fact: [start date],
// [CLIENT NAME], {date}, {{name}}, <name>, XX, XX/XX/XXXX, ____, TBD. A
// markdown link's text ([IRCC's notice](https://...)) is followed by "(" and
// passes. So does an autolink (<https://...>) and a bare HTML tag like <br>.
// A bracket with no letter in it ([1]) reads as a footnote and passes too.
const PLACEHOLDER = [
  /\[[^\[\]\n]*[A-Za-z][^\[\]\n]*\](?!\()/,
  /\{[^{}\n]*\}/,
  /<(?!(?:br|p|b|i|em|strong|u|ul|ol|li|hr|span|div)\s*\/?>)[A-Za-z][A-Za-z _-]*>/i,
  /(?<![A-Za-z0-9])X{2,}(?![A-Za-z0-9])/,
  /_{3,}/,
  /\bTB[DCA]\b/i,
];

function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.some((re) => re.test(text));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Same boundary as the web's tokenize() in web/src/lib/briefs.ts, so "c1"
// doesn't match inside "c12" and "2026-042" doesn't match inside "F-2026-042".
function idPattern(clientId: string, flags: string, prefix = ''): RegExp | null {
  const id = clientId.trim();
  if (!id) return null;
  return new RegExp(`${prefix}(?<![A-Za-z0-9_-])${escapeRegExp(id)}(?![A-Za-z0-9_-])`, flags);
}

/** What's wrong with a drafted body's voice. Empty means it reads right. */
export function checkBriefVoice(body: string, clientId: string): VoiceFinding[] {
  const findings: VoiceFinding[] = [];
  if (YOUR_CLIENT.test(body)) findings.push('your-client');
  if (idPattern(clientId, '')?.test(body)) findings.push('client-id');
  if (INTERNAL_TERM.test(body)) findings.push('internal-term');
  if (hasPlaceholder(body)) findings.push('placeholder');
  return findings;
}

/**
 * The body's findings, plus a placeholder in the subject or the suggested
 * actions. The client reads all three.
 */
export function checkDraftVoice(
  draft: { subject: string; bodyMarkdown: string; suggestedActions: string[] },
  clientId: string,
): VoiceFinding[] {
  const findings = checkBriefVoice(draft.bodyMarkdown, clientId);
  if (!findings.includes('placeholder') && [draft.subject, ...draft.suggestedActions].some(hasPlaceholder)) {
    findings.push('placeholder');
  }
  return findings;
}

function firstPersonForm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\bwe'll\b/g, 'we will')
    .replace(/\bwe're\b/g, 'we are')
    .replace(/\bwe've\b/g, 'we have')
    .replace(/\s+/g, ' ');
}

/**
 * IRCC's first person copied into a draft. Only wording found in the rule text
 * counts, since "I recommend we hold your file" is the consultant speaking.
 */
export function checkAgencyVoice(text: string, ruleText: string): VoiceFinding[] {
  const rule = firstPersonForm(ruleText);
  for (const m of firstPersonForm(text).matchAll(/\b(?:we|our)\b(?: [\w'-]+){1,3}/g)) {
    if (rule.includes(m[0])) return ['agency-first-person'];
  }
  return [];
}

/**
 * IRCC's text with IRCC named in place of its first person. Only ever used for
 * what Composer reads. The stored rule keeps IRCC's own words.
 */
export function inThirdPerson(text: string): string {
  return text
    .replace(/\bwe['’]ll\b/gi, 'IRCC will')
    .replace(/\bwe will\b/gi, 'IRCC will')
    .replace(/\bwe['’]re\b/gi, 'IRCC is')
    .replace(/\bwe are\b/gi, 'IRCC is')
    .replace(/\bwe['’]ve\b/gi, 'IRCC has')
    .replace(/\bwe have\b/gi, 'IRCC has')
    .replace(/\bwe don['’]t\b/gi, "IRCC doesn't")
    .replace(/\bwe do not\b/gi, 'IRCC does not')
    .replace(/\bwe\b/gi, 'IRCC')
    .replace(/\bour\b/gi, "IRCC's")
    .replace(/\bus\b/g, 'IRCC');
}

/**
 * The body with its citation. The prompt asks for the link, but the model often
 * leaves it out, as the Oct 16 C-103 brief did, and a client should always be able
 * to check the source.
 */
export function withCitation(body: string, url: string | undefined): string {
  if (!url || body.includes(url)) return body;
  return `${body.trimEnd()}\n\n[IRCC's notice](${url})`;
}

/**
 * The Analyst writes its narrative about the client by id ("2026-042 can't
 * sponsor..."). Composer only needs to know it's the reader, so the id is
 * swapped out before the text reaches the model and can't be copied into the
 * body.
 */
export function withoutClientId(text: string, clientId: string): string {
  // Takes a leading "client " with it, so "Client 2026-042 can't" becomes
  // "the client can't" and never "Client the client can't".
  const re = idPattern(clientId, 'gi', '(?:\\bclient\\s+)?');
  return re ? text.replace(re, 'the client') : text;
}
