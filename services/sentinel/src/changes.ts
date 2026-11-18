// What changed between two versions of an IRCC page, worked out by code.
//
// IRCC often adds a dated change to a page and leaves the older text it replaces
// further down. Brief 88d1df46 (client C-103, 2026-10-16) said "you no longer
// need an LMIA" next to advice to confirm an older exemption, because the agents
// read the whole page and nothing told them which lines were new. So Sentinel
// stores the changed lines on the rule row and the agents read those.
//
// A line's identity is its wording plus where it sits: its section, and the
// lead-in, table header or parent bullet it hangs from. Comparing wording alone
// loses real changes. On the Nov 3 job offer page, "Programs that required a valid
// job offer... still require one, including" arrived without its programs, because
// the same bullets sat elsewhere on the old page, and a bullet moving from "you
// need an LMIA" to "you don't" read as no change at all.
//
// Only structure is added as context, since a neighbouring line can be the older
// text this exists to keep out. The one exception is a line whose order changed,
// where the line above it is the point. For the same reason a line that only ended
// up under a brand new subheading isn't a change. On Oct 16 IRCC added a subheading
// above older text about job offer points, which read as moved until this rule. A
// line that moved into a section already on the page is a change, and shows.
//
// No model is involved. ADR-0001 has the reasoning.

export const CHANGES_HEADER = 'CHANGES TO THIS IRCC PAGE';
export const ADDED_HEADER = 'LINES ADDED TO THE PAGE';
export const REMOVED_HEADER = 'LINES REMOVED FROM THE PAGE';
export const PARTIAL_MARK = '[Part of this change is not shown';
export const MAX_CHANGES_BYTES = 100_000;
// DynamoDB items stop at 400 KB and the page text shares the row. This leaves
// room for the other fields.
const MAX_PAGE_AND_CHANGES_BYTES = 380_000;
// A reworded heading or table header moves every line under it, and a long table
// doesn't need all its rows repeated. Past this, the text says part of the change is
// left out, and the Analyst sends those clients to a consultant.
const MAX_MOVED_RUN = 40;
// A new heading above unchanged lines can change what they mean, so a few of them
// show when nothing new sits under it.
const MAX_LINES_UNDER_NEW_HEADING = 5;

export type RuleChanges = {
  previous_hash: string;
  added_lines: number;
  removed_lines: number;
  moved_lines: number;
  reordered_lines: number;
  truncated: boolean;
  text: string;
};

type Kind = 'heading' | 'row' | 'item' | 'paragraph';

type Line = {
  raw: string;
  folded: string;
  kind: Kind;
  // The headings above the line, page title first, as IRCC wrote them.
  section: string[];
  // The same headings without the page title, to say where a moved line came from.
  under: string[];
  // Where the line sits, for comparing. A reworded page title shouldn't move every
  // line on the page, so the title stays out of it. A heading repeated under one
  // parent gets a number, so a move between the two copies still shows.
  place: string[];
  // What the line hangs from: a lead-in, then a table header or parent bullets.
  context: Line[];
  key: string;
};

// A curly apostrophe swapped for a straight one is not a change. The fold is for
// comparing only, so the stored lines keep IRCC's own characters.
function fold(line: string): string {
  return line
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const isHeading = (line: string) => /^#{1,6}\s/.test(line);
const isListItem = (line: string) => /^\s*[-*•]\s/.test(line);
const isTableRow = (line: string) => line.includes(' | ');
const depthOf = (line: string) => line.length - line.trimStart().length;

function parse(text: string): Line[] {
  const out: Line[] = [];
  const headings: string[] = [];
  const places: string[] = [];
  const seenPlaces = new Map<string, number>();
  let leadIn: Line | null = null;
  let tableHeader: Line | null = null;
  let parents: Line[] = [];

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;

    if (isHeading(raw)) {
      const level = (/^#+/.exec(raw) as RegExpExecArray)[0].length;
      const wording = raw.replace(/^#+\s*/, '').trim();
      headings.length = Math.min(headings.length, level - 1);
      places.length = Math.min(places.length, level - 1);
      const folded = fold(wording);
      const place = placeOf(places);
      const asPlace = [...place, folded].join(SEP);
      const seen = (seenPlaces.get(asPlace) ?? 0) + 1;
      seenPlaces.set(asPlace, seen);
      const segment = seen > 1 ? `${folded}\u0002${seen}` : folded;
      headings[level - 1] = wording;
      places[level - 1] = segment;
      out.push({ raw, folded, kind: 'heading', section: headings.filter(Boolean), under: headings.slice(1).filter(Boolean), place, context: [], key: keyOf('heading', place, [], segment) });
      leadIn = tableHeader = null;
      parents = [];
      continue;
    }

    const folded = fold(raw);
    const place = placeOf(places);
    const section = headings.filter(Boolean);
    const under = headings.slice(1).filter(Boolean);
    const line = (kind: Kind, context: Line[]): Line => ({ raw, folded, kind, section, under, place, context, key: keyOf(kind, place, context, folded) });

    if (isTableRow(raw)) {
      const row = line('row', [...(leadIn ? [leadIn] : []), ...(tableHeader ? [tableHeader] : [])]);
      tableHeader ??= row;
      out.push(row);
      continue;
    }
    tableHeader = null;

    if (isListItem(raw)) {
      parents = parents.filter((p) => depthOf(p.raw) < depthOf(raw));
      const item = line('item', [...(leadIn ? [leadIn] : []), ...parents]);
      parents.push(item);
      out.push(item);
      continue;
    }

    const paragraph = line('paragraph', []);
    leadIn = paragraph;
    parents = [];
    out.push(paragraph);
  }
  return out;
}

const SEP = '\u0001';

function placeOf(places: string[]): string[] {
  return places.slice(1).filter(Boolean);
}

function keyOf(kind: Kind, place: string[], context: Line[], wording: string): string {
  return [kind === 'heading' ? 'h' : 'l', place.join(SEP), contextOf(context), wording].join('\u0000');
}

const contextOf = (context: Line[]) => context.map((c) => c.folded).join(SEP);

const headingWordings = (lines: Line[]) => new Set(lines.filter((l) => l.kind === 'heading').map((l) => l.folded));

// True when a line kept what it hangs from and only gained a brand new subheading
// above it, or lost one IRCC deleted. A subheading whose wording is on both versions
// means the line, or the heading, really moved.
function onlySubheadingChanged(to: Line, from: Line, headingsBefore: Set<string>, headingsAfter: Set<string>): boolean {
  if (contextOf(to.context) !== contextOf(from.context)) return false;
  const gained = to.place.length >= from.place.length;
  const [short, long] = gained ? [from.place, to.place] : [to.place, from.place];
  if (!short.every((heading, i) => long[i] === heading)) return false;
  const other = gained ? headingsBefore : headingsAfter;
  return long.slice(short.length).every((segment) => !other.has(segment.split('\u0002')[0]));
}

/** The lines with no counterpart in `other`. A repeated line needs a repeat to match. */
function unmatched(lines: Line[], other: Line[]): Set<Line> {
  const counts = new Map<string, number>();
  for (const l of other) counts.set(l.key, (counts.get(l.key) ?? 0) + 1);
  const out = new Set<Line>();
  for (const l of lines) {
    const left = counts.get(l.key) ?? 0;
    if (left > 0) counts.set(l.key, left - 1);
    else out.add(l);
  }
  return out;
}

/** Pairs each new line with a line that had the same wording somewhere else. */
function pairMoves(added: Set<Line>, removed: Set<Line>): Map<Line, Line> {
  const byWording = new Map<string, Line[]>();
  const wording = (l: Line) => `${l.kind === 'heading' ? 'h' : 'l'}\u0000${l.folded}`;
  for (const l of removed) byWording.set(wording(l), [...(byWording.get(wording(l)) ?? []), l]);
  const moves = new Map<Line, Line>();
  for (const l of added) {
    const from = byWording.get(wording(l))?.shift();
    if (from) moves.set(l, from);
  }
  return moves;
}

// Lines that kept their wording and place but not their order, which can change what
// they mean ("Inside Canada: / Apply online." and "Outside Canada: / Apply on paper.").
// Only the fewest lines that explain the new order are marked, so one moved paragraph
// doesn't drag older text in around it.
function reorderedLines(before: Line[], after: Line[], settled: Set<Line>): Set<Line> {
  const byScope = (lines: Line[]) => {
    const groups = new Map<string, Line[]>();
    for (const l of lines) {
      if (l.kind === 'heading' || settled.has(l)) continue;
      const scope = [l.place.join(SEP), contextOf(l.context)].join('\u0000');
      groups.set(scope, [...(groups.get(scope) ?? []), l]);
    }
    return groups;
  };
  const old = byScope(before);
  const out = new Set<Line>();
  for (const [scope, lines] of byScope(after)) {
    const slots = new Map<string, number[]>();
    (old.get(scope) ?? []).forEach((l, i) => slots.set(l.folded, [...(slots.get(l.folded) ?? []), i]));
    const kept = longestIncreasing(lines.map((l) => slots.get(l.folded)?.shift() ?? -1));
    lines.forEach((l, i) => {
      if (!kept.has(i)) out.add(l);
    });
  }
  return out;
}

/** The indexes of a longest increasing run in `values`. */
function longestIncreasing(values: number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  values.forEach((value, i) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[tails[mid]] < value) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[i] = tails[low - 1];
    tails[low] = i;
  });
  const out = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i !== -1; i = previous[i]) out.add(i);
  return out;
}

const CONTEXT_LABEL: Record<Kind, string> = { paragraph: 'lead-in', row: 'table header', item: 'parent', heading: 'heading' };

function originOf(from: Line, to: Line): string {
  const samePlace = from.place.join(SEP) === to.place.join(SEP);
  // In the same section, what the line used to hang from is the part that changed.
  const left = from.context.find((c, i) => c.folded !== to.context[i]?.folded) ?? from.context[from.context.length - 1];
  const origin = samePlace && left ? fold(left.raw) : from.under.join(' > ') || 'top of page';
  return origin.length > 100 ? `${origin.slice(0, 97)}...` : origin;
}

function render(lines: Line[], show: { changed: Set<Line>; moved?: Map<Line, Line>; reordered?: Set<Line>; fillNewHeadings?: boolean }): string {
  const groups = new Map<string, string[]>();
  const lastContext = new Map<string[], string>();
  const groupFor = (line: Line): string[] => {
    const path = line.section.join(' > ') || '(top of page)';
    let group = groups.get(path);
    if (!group) {
      group = [];
      groups.set(path, group);
    }
    return group;
  };

  // A run of lines under one marker, cut once it's long.
  let run: { marker: string; shown: number; hidden: number; group: string[] | null } = { marker: '', shown: 0, hidden: 0, group: null };
  const endRun = () => {
    if (run.hidden > 0) run.group?.push(`${PARTIAL_MARK}: ${run.hidden} more lines changed in the same way.]`);
    run = { marker: '', shown: 0, hidden: 0, group: null };
  };

  let above = '';
  for (const line of lines) {
    const from = show.moved?.get(line);
    const hit = show.changed.has(line);
    const shuffled = show.reordered?.has(line) ?? false;
    const lineAbove = above;
    if (line.kind !== 'heading') above = line.raw.trim();

    if (line.kind === 'heading') {
      // A heading that only moved adds nothing: the lines under it say where they went.
      if (hit) {
        endRun();
        groupFor(line);
      }
      continue;
    }
    if (!hit && !from && !shuffled) {
      endRun();
      continue;
    }

    const group = groupFor(line);
    if (group !== run.group) endRun();
    const marker = from ? `(moved here from "${originOf(from, line)}", same wording)` : shuffled ? '(same wording, order changed)' : '';
    if (marker && run.marker === marker && run.shown >= MAX_MOVED_RUN) {
      run.hidden += 1;
      continue;
    }

    // Printed when what the line hangs from differs from the line before it, so a
    // bullet can't read as hanging from someone else's lead-in.
    const chain = contextOf(line.context);
    if (lastContext.get(group) !== chain) {
      for (const c of line.context) {
        if (!show.changed.has(c) && !show.moved?.has(c)) group.push(`(unchanged ${CONTEXT_LABEL[c.kind]}) ${c.raw.trim()}`);
      }
      lastContext.set(group, chain);
    }

    if (marker) {
      if (run.marker !== marker) {
        endRun();
        group.push(marker);
        run = { marker, shown: 0, hidden: 0, group };
      }
      run.shown += 1;
      if (shuffled && lineAbove) group.push(`(now follows) ${lineAbove}`);
    } else {
      endRun();
    }
    group.push(line.raw);
  }
  endRun();

  if (show.fillNewHeadings) {
    for (const heading of lines) {
      if (heading.kind !== 'heading' || !show.changed.has(heading)) continue;
      const path = heading.section.join(' > ');
      if (groups.get(path)?.length !== 0) continue;
      const under = lines.filter((l) => l.kind !== 'heading' && l.section.join(' > ') === path);
      if (under.length === 0) continue;
      const shown = under.slice(0, MAX_LINES_UNDER_NEW_HEADING).map((l) => l.raw);
      const rest = under.length - shown.length;
      groups.get(path)?.push('(unchanged, now under this new heading)', ...shown, ...(rest > 0 ? [`(${rest} more unchanged lines not shown)`] : []));
    }
  }

  return [...groups.entries()].map(([path, shown]) => [`Section: ${path}`, ...shown].join('\n')).join('\n\n');
}

/** Lines added to, moved on and removed from a page. */
export function ruleChanges(opts: {
  previousText: string;
  text: string;
  previousHash: string;
  sourceUrl: string;
  detectedAt: string;
}): RuleChanges {
  const before = parse(opts.previousText);
  const after = parse(opts.text);
  const newLines = unmatched(after, before);
  const oldLines = unmatched(before, after);

  const pairs = pairMoves(newLines, oldLines);
  const headingsBefore = headingWordings(before);
  const headingsAfter = headingWordings(after);
  const moved = new Map<Line, Line>();
  for (const [to, from] of pairs) {
    newLines.delete(to);
    oldLines.delete(from);
    if (!onlySubheadingChanged(to, from, headingsBefore, headingsAfter)) moved.set(to, from);
  }
  // Compared only among lines that stayed put in both versions.
  const reordered = reorderedLines(before, after, new Set([...newLines, ...oldLines, ...pairs.keys(), ...pairs.values()]));

  const room = Math.max(1_000, Math.min(MAX_CHANGES_BYTES, MAX_PAGE_AND_CHANGES_BYTES - Buffer.byteLength(opts.text)));
  const full = fitted(
    [CHANGES_HEADER, `Page: ${opts.sourceUrl}`, `Detected: ${opts.detectedAt.slice(0, 10)}`, '', ADDED_HEADER].join('\n'),
    render(after, { changed: newLines, moved, reordered, fillNewHeadings: true }) || '(none)',
    `${REMOVED_HEADER}\n${render(before, { changed: oldLines }) || '(none)'}`,
    room,
  );

  return {
    previous_hash: opts.previousHash,
    added_lines: newLines.size,
    removed_lines: oldLines.size,
    moved_lines: [...moved.keys()].filter((l) => l.kind !== 'heading').length,
    reordered_lines: reordered.size,
    truncated: full.includes(PARTIAL_MARK),
    text: full,
  };
}

/** False when only quote style or spacing differs. */
export function hasChanges(changes: RuleChanges): boolean {
  return changes.added_lines > 0 || changes.removed_lines > 0 || changes.moved_lines > 0 || changes.reordered_lines > 0;
}

// Added lines get the room first. Removed lines keep a quarter of it, so a long rewrite
// can't hide that something was taken away.
function fitted(header: string, added: string, removed: string, maxBytes: number): string {
  const joined = `${header}\n${added}\n\n${removed}`;
  if (Buffer.byteLength(joined) <= maxBytes) return joined;
  const removedRoom = Math.min(Buffer.byteLength(removed), Math.floor(maxBytes / 4));
  const addedRoom = maxBytes - Buffer.byteLength(header) - removedRoom;
  return `${header}\n${cut(added, addedRoom)}\n\n${cut(removed, removedRoom)}`;
}

function cut(text: string, maxBytes: number): string {
  const total = Buffer.byteLength(text);
  if (total <= maxBytes) return text;
  const note = `${PARTIAL_MARK}: this part runs to ${total} bytes and only the start is stored.]`;
  const kept: string[] = [];
  let bytes = Buffer.byteLength(note) + 1;
  for (const line of text.split('\n')) {
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > maxBytes) break;
    kept.push(line);
  }
  return [...kept, note].join('\n');
}
