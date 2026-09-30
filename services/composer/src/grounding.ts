// A brief goes to the client, so every IRCC fact in it has to come from the
// rule text or the signed assessment Composer was given (ADR-0001: no IRCC
// interpretation from model memory). This check pulls the specifics a model
// is most likely to fill in from memory (numbers, durations, dollar amounts,
// dates, program names) out of the drafted body and reports the ones that
// appear in none of the sources.
//
// It's a plain text match, so it flags likely problems and can't prove a
// claim true. A paraphrase that keeps the number ("5 years per entry" for
// "5 years at a time") passes. A number the sources never mention doesn't.
//
// checkDateRoles covers the other way a grounded date goes wrong: the date is
// in the sources, but as a fact about the client (their program start date),
// and the brief states it as the policy's own date.

export type GroundingFindingKind = 'money' | 'date' | 'duration' | 'number' | 'program' | 'policy-date-from-client';
export type GroundingFinding = { kind: GroundingFindingKind; value: string };

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const UNIT = '(business day|year|month|week|day|hour)s?';
const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
};

// Words that end a program name when reading backwards from "visa",
// "program" and so on. "a super visa" gives "super visa".
const STOP = new Set(
  ('a an the your you my our their this that these those for of under new any same current to and or with ' +
    'through via i we is are was be in on by from as at its his her per if not no option options').split(' '),
);
const PROGRAM_NOUN = /\b(program|visa|permit|pilot|stream|class|sponsorship)s?\b/gi;
// The agency itself. The prompt tells the model to name it, and a notice
// can refer to itself as "we" instead.
const KNOWN_ACRONYMS = new Set(['IRCC']);

// "january 11, 2027", "11 january 2027" and "2027-01-11". Run on normalized text.
function dateRe(): RegExp {
  return new RegExp(`\\b(${MONTHS}) (\\d{1,2})(?:, ?(\\d{4}))?\\b|\\b(\\d{1,2}) (${MONTHS})(?: (\\d{4}))?\\b|\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'g');
}

const MONTH_NUMBER = new Map(MONTHS.split('|').map((name, i) => [name, i + 1]));

// Month and day as numbers, year if the text gives one.
function dateParts(m: RegExpMatchArray): { month: number; day: number; year: string | undefined } {
  if (m[7]) return { month: Number(m[8]), day: Number(m[9]), year: m[7] };
  return { month: MONTH_NUMBER.get(m[1] ?? m[5]) ?? 0, day: Number(m[2] ?? m[4]), year: m[3] ?? m[6] };
}

// Every date a source gives, in both spellings' common form, so an Analyst's
// "2027-01-11" grounds a brief's "January 11, 2027".
function dateKeys(source: string): Set<string> {
  const keys = new Set<string>();
  for (const m of source.matchAll(dateRe())) {
    const { month, day, year } = dateParts(m);
    keys.add(`${month}-${day}`);
    if (year) keys.add(`${year}-${month}-${day}`);
  }
  return keys;
}

function dateGrounded(m: RegExpMatchArray, source: string, keys: Set<string>): boolean {
  const { month, day, year } = dateParts(m);
  if (keys.has(year ? `${year}-${month}-${day}` : `${month}-${day}`)) return true;
  if (m[7]) return source.includes(m[0]);
  const name = m[1] ?? m[5];
  // Whole day numbers only, so "january 1" doesn't ground "january 11".
  const dayMonth = new RegExp(`\\b${name} ${day}(?!\\d)|(?<!\\d)${day} ${name}\\b`).test(source);
  return dayMonth && (!year || hasNumber(source, year));
}

// The body as claims: links are the citation, which is a source already, so
// their digits aren't claims, and neither are list markers.
function claimText(body: string): string {
  return normalize(
    body
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^\s*\d+[.)]\s/gm, ' '),
  );
}

/** Lowercase, straight punctuation, "five years" as "5 years", "15,000" as "15000". */
export function normalize(text: string): string {
  return text
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/ /g, ' ')
    .toLowerCase()
    .replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})(?=[\\s-]+${UNIT}\\b)`, 'g'), (w) => NUMBER_WORDS[w])
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ');
}

function hasNumber(source: string, n: string): boolean {
  return new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(source);
}

// Replaces a matched span with spaces so later passes don't read it again.
function mask(text: string, re: RegExp, each: (m: RegExpExecArray) => void): string {
  return text.replace(re, (...args) => {
    const m = args as unknown as RegExpExecArray;
    each(m);
    return ' '.repeat(m[0].length);
  });
}

function programPhrases(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(PROGRAM_NOUN)) {
    const before = body.slice(0, m.index).split(/([^A-Za-z'-]+)/);
    const words: string[] = [];
    // Walk back over words joined only by spaces, stopping at punctuation
    // or a stop word. At most 3 words ahead of the noun.
    for (let i = before.length - 1; i >= 0 && words.length < 3; i -= 1) {
      const part = before[i];
      if (i % 2 === 1) {
        if (!/^ +$/.test(part)) break;
        continue;
      }
      if (!part) continue;
      if (STOP.has(part.toLowerCase())) break;
      words.unshift(part);
    }
    if (words.length === 0) continue;
    out.push(`${words.join(' ')} ${m[1]}`);
  }
  return out;
}

/**
 * Specifics in the body that none of the sources mention. Empty means every
 * number, duration, amount, date and program name was found in a source.
 */
export function checkBriefGrounding(body: string, sources: string[]): GroundingFinding[] {
  const source = normalize(sources.join('\n'));
  const findings: GroundingFinding[] = [];
  const seen = new Set<string>();
  const add = (kind: GroundingFindingKind, value: string, grounded: boolean) => {
    const key = `${kind}:${value}`;
    if (grounded || seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, value });
  };

  let text = claimText(body);

  text = mask(text, /\$\s?(\d+(?:\.\d+)?)(?:\s?(?:million|billion))?/g, (m) => add('money', m[0], hasNumber(source, m[1])));

  const keys = dateKeys(source);
  text = mask(text, dateRe(), (m) => add('date', m[0], dateGrounded(m, source, keys)));

  text = mask(text, new RegExp(`(?<![\\d.])(\\d+(?:\\.\\d+)?)(?: |-)${UNIT}\\b`, 'g'), (m) => {
    const stem = m[2];
    const inSource = new RegExp(`(?<![\\d.])${m[1].replace('.', '\\.')}(?: |-)${stem}`).test(source);
    add('duration', m[0], inSource);
  });

  mask(text, /(?<![\w.])\d+(?:\.\d+)?(?![\w])/g, (m) => add('number', m[0], hasNumber(source, m[0])));

  // Program names are read from the original body so acronyms keep their case.
  const raw = body.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ');
  for (const phrase of programPhrases(raw)) {
    // The noun is kept singular, so "study permits" in the source grounds
    // "study permit" in the body and the other way round.
    const p = normalize(phrase);
    add('program', p, source.includes(p));
  }
  for (const m of raw.matchAll(/\b[A-Z]{2,6}(?=s?\b)/g)) {
    if (KNOWN_ACRONYMS.has(m[0])) continue;
    add('program', m[0], new RegExp(`\\b${m[0]}`, 'i').test(sources.join('\n')));
  }
  return findings;
}

// The reader as the subject: "your program starts", "you start". A sentence
// that talks about the reader before the date is saying the date is theirs.
const READER = /\byou(?:r|'re|'ve|'ll)?\b/;
// Words that turn the date right after them into a cut-off: "on or after
// January 11, 2027" is when a policy applies, whoever the sentence is about.
const CUT_OFF = /\b(?:on or after|on or before|after|before|as of|effective|until|by|since|no later than)\s*$/;

/**
 * Dates the brief states as policy facts that only the client-specific
 * sources give. Live case (brief 9aa15dff, 2026-09-30): the consultant's
 * review said the client's program starts 2027-01-11, and the brief said the
 * exemption "applies to master's programs ... starting January 11, 2027". The
 * rule's own date is January 1, 2026.
 *
 * Deterministic and narrow on purpose. A date is flagged only when the policy
 * sources don't give it, the client sources do, and its sentence doesn't make
 * it the reader's: no "you" or "your" before it, or a cut-off word ("on or
 * after", "before", "as of") right in front of it. Dates no source gives are
 * checkBriefGrounding's job.
 */
export function checkDateRoles(body: string, policySources: string[], clientSources: string[]): GroundingFinding[] {
  const policy = normalize(policySources.join('\n'));
  const client = normalize(clientSources.join('\n'));
  const policyKeys = dateKeys(policy);
  const clientKeys = dateKeys(client);
  const findings: GroundingFinding[] = [];
  const seen = new Set<string>();

  // Split into lines before normalize folds the line breaks, so a suggested
  // action without a full stop stays its own sentence.
  const sentences = body.split('\n').flatMap((line) => claimText(line).split(/(?<=[.!?]) /));
  for (const sentence of sentences) {
    for (const m of sentence.matchAll(dateRe())) {
      if (dateGrounded(m, policy, policyKeys) || !dateGrounded(m, client, clientKeys)) continue;
      const before = sentence.slice(0, m.index);
      if (READER.test(before) && !CUT_OFF.test(before)) continue;
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      findings.push({ kind: 'policy-date-from-client', value: m[0] });
    }
  }
  return findings;
}
