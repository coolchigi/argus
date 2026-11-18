// Which IRCC text an agent reads, identical in Analyst, Auditor and Composer.
// A test in the Analyst fails if the copies drift, or if the headers stop
// matching what Sentinel writes in services/sentinel/src/changes.ts.
//
// Generic on purpose: no program, threshold or date (ADR-0001).

import { profileNeedles, RULE_WINDOW_CHARS } from './rule-window.ts';

export const CHANGES_HEADER = 'CHANGES TO THIS IRCC PAGE';
export const ADDED_HEADER = 'LINES ADDED TO THE PAGE';
export const REMOVED_HEADER = 'LINES REMOVED FROM THE PAGE';
export const PARTIAL_MARK = '[Part of this change is not shown';
const UNCHANGED_HEADER = 'OTHER PAGE TEXT THAT MENTIONS THIS CLIENT';
const UNCHANGED_MAX_CHARS = 3_000;


/**
 * The changed lines when the rule row has them, sized to fit the agent's window.
 * With a client profile, it also says whether the client's codes are on the rest
 * of the page, since one added row says nothing about the rows around it. A row
 * captured before changes were stored gives the whole page.
 */
export function ruleTextFor(
  row: { rule_content?: unknown; rule_changes?: { text?: unknown } } | undefined,
  profile?: Record<string, unknown>,
): string {
  const page = typeof row?.rule_content === 'string' ? row.rule_content : '';
  const changes = row?.rule_changes?.text;
  if (typeof changes !== 'string' || !changes.startsWith(CHANGES_HEADER)) return page;

  const codes = profileNeedles(profile);
  const shown = fitted(changes, codes, RULE_WINDOW_CHARS - (codes.length > 0 ? UNCHANGED_MAX_CHARS + 2 : 0));
  const unchanged = unchangedMentions(page, shown, codes);
  return unchanged ? `${shown}\n\n${unchanged}` : shown;
}

export function isChangesText(text: string): boolean {
  return text.startsWith(CHANGES_HEADER);
}

/** True when a very long change didn't fit, so the agents saw only part of it. */
export function isPartialView(text: string): boolean {
  return isChangesText(text) && text.includes(PARTIAL_MARK);
}

/** True when IRCC only took text away, so the rule as it stands now isn't shown. */
export function isRemovalOnly(text: string): boolean {
  return isChangesText(text) && text.includes(`${ADDED_HEADER}\n(none)`);
}

/**
 * What the guardrail may treat as support for a claim. Old wording can't support a
 * claim about today's rules, so removed lines stay out, unless the removal is the
 * whole change and they're all there is to support it.
 */
export function groundingTextFor(text: string): string {
  if (!isChangesText(text) || isRemovalOnly(text)) return text;
  const start = text.indexOf(`\n${REMOVED_HEADER}`);
  if (start === -1) return text;
  const end = text.indexOf(`\n${UNCHANGED_HEADER}`, start);
  return end === -1 ? text.slice(0, start) : text.slice(0, start) + text.slice(end);
}

// Added lines get the room first. Removed lines keep a quarter of it, so a long
// rewrite can't hide that something was taken away.
function fitted(text: string, codes: string[], room: number): string {
  if (text.length <= room) return text;
  const at = text.indexOf(`\n${REMOVED_HEADER}`);
  if (at === -1) return cutSide(text, codes, room);
  const removed = text.slice(at + 1);
  const added = cutSide(text.slice(0, at), codes, room - Math.min(removed.length, Math.floor(room / 4)) - 1);
  return `${added}\n${cutSide(removed, codes, room - added.length - 1)}`;
}

// Keeps a side's header, so a removed line can never pass for a current one. A
// later line with one of the client's codes stays, under the same header.
function cutSide(side: string, codes: string[], room: number): string {
  if (side.length <= room) return side;
  const lines = side.split('\n');
  const note = `${PARTIAL_MARK}: this part runs to ${side.length} characters and the rest is left out.]`;

  const later: string[] = [];
  let laterChars = 0;
  for (const line of lines) {
    if (!codes.some((c) => line.includes(c))) continue;
    if (laterChars + line.length + 1 > Math.floor(room / 4)) break;
    later.push(line);
    laterChars += line.length + 1;
  }

  const head: string[] = [];
  let headChars = 0;
  for (const line of lines) {
    if (headChars + line.length + 1 > room - note.length - laterChars - 1) break;
    head.push(line);
    headChars += line.length + 1;
  }
  return [...head, note, ...later.filter((l) => !head.includes(l))].join('\n');
}

// Stated from a search of the whole page, so "not on the page" is true when it's
// said. A plain substring search, so a replay gets the same text. A line showing only
// among the removed lines doesn't count as shown: the same wording can be gone from
// one place and still stand in another.
function unchangedMentions(page: string, shown: string, codes: string[]): string {
  if (codes.length === 0) return '';
  const current = shown.split(`\n${REMOVED_HEADER}`)[0];

  const headings: string[] = [];
  let leadIn = '';
  let tableHeader = '';
  const groups = new Map<string, string[]>();
  for (const raw of page.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) {
      const level = (/^#+/.exec(line) as RegExpExecArray)[0].length;
      headings.length = Math.min(headings.length, level - 1);
      headings[level - 1] = line.replace(/^#+\s*/, '');
      leadIn = tableHeader = '';
      continue;
    }
    const isRow = line.includes(' | ');
    const isItem = /^[-*•]\s/.test(line);
    if (codes.some((c) => line.includes(c)) && !current.includes(line)) {
      const path = headings.filter(Boolean).join(' > ') || '(top of page)';
      const group = groups.get(path) ?? [];
      groups.set(path, group);
      const context = isRow && tableHeader ? `(unchanged table header) ${tableHeader}` : isItem && leadIn ? `(unchanged lead-in) ${leadIn}` : '';
      if (context && !group.includes(context)) group.push(context);
      group.push(line);
    }
    if (isRow) {
      tableHeader ||= line;
    } else {
      tableHeader = '';
      if (!isItem) leadIn = line;
    }
  }

  const missing = codes.filter((c) => !page.includes(c));
  if (groups.size === 0 && missing.length === 0) return '';

  const out: string[] = [UNCHANGED_HEADER];
  let used = out[0].length;
  const push = (line: string): boolean => {
    if (used + line.length + 1 > UNCHANGED_MAX_CHARS - 200) return false;
    out.push(line);
    used += line.length + 1;
    return true;
  };
  push("The wording of these lines did not change. They show where the client's codes are on the page.");
  outer: for (const [path, lines] of groups) {
    if (!push(`Section: ${path}`)) break;
    for (const line of lines) if (!push(line)) break outer;
  }
  if (missing.length > 0) out.push(`[The whole page was searched. None of it contains: ${missing.join(', ')}.]`);
  return out.join('\n');
}

export const READING_CHANGES = [
  'READING THE CHANGE:',
  "- RULE CONTENT holds only the lines IRCC added to, moved on or removed from this page since its last version, grouped under the page's section headings. The rest of the page is not shown because it did not change.",
  '- Added, moved and removed lines are all part of the change.',
  "- A removed line is a sentence the page no longer says, so do not rely on it. It does not mean the thing the sentence talks about was removed. If a removed line said something is not needed, the page has stopped saying it is not needed, which does not tell you what applies now.",
  "- If nothing was added, the removal is the change. Report what the page no longer says. If a removed line covered the client's situation, the client is affected, because the consultant has to check what applies now.",
  '- A line after "(moved here from ...)" keeps its wording but now sits somewhere new. Read it by where it sits now. A move can reverse what a line means, so if the moved line matches the client, the client is affected.',
  '- A line after "(same wording, order changed)" kept its wording but not its place in the order, and "(now follows)" shows the line above it now. Order can change what a line means.',
  '- A line marked "(unchanged ...)" or "(now follows)" is shown only so the lines around it make sense. It is not part of the change.',
  '- A value missing from these lines may still be on the part of the page that is not shown, so missing from these lines is not a finding. It counts as absent from a list only when the whole list is among the added lines, or a note says the whole page was searched and does not contain it.',
  '- If a note says part of this change is not shown, say so in your reasoning and advise reading the page.',
  '- Before you state a step from the added lines, find the case it belongs to: the heading above it, or the "if" that opens its sentence. If the client profile does not show that case is true, open the step with that same "if", in the page\'s words. Keep "should" where the page says "should".',
  '- Report what the page tells people to enter or select as the page\'s own instruction ("IRCC\'s page says to enter..."), using the page\'s words and values. Add no words of your own about the values.',
].join('\n');
