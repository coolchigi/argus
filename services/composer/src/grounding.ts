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

export type GroundingFindingKind = 'money' | 'date' | 'duration' | 'number' | 'program';
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

  // Links are the citation, which is a source already. Their digits aren't claims.
  let text = normalize(
    body
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^\s*\d+[.)]\s/gm, ' '),
  );

  text = mask(text, /\$\s?(\d+(?:\.\d+)?)(?:\s?(?:million|billion))?/g, (m) => add('money', m[0], hasNumber(source, m[1])));

  text = mask(
    text,
    new RegExp(`\\b(${MONTHS}) (\\d{1,2})(?:, ?(\\d{4}))?\\b|\\b(\\d{1,2}) (${MONTHS})(?: (\\d{4}))?\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, 'g'),
    (m) => {
      if (!m[1] && !m[5]) return add('date', m[0], source.includes(m[0]));
      const month = m[1] ?? m[5];
      const day = m[2] ?? m[4];
      const year = m[3] ?? m[6];
      const dayMonth = source.includes(`${month} ${day}`) || source.includes(`${day} ${month}`);
      add('date', m[0], dayMonth && (!year || hasNumber(source, year)));
    },
  );

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
