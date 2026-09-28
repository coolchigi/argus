// Rule text window, identical in Analyst, Auditor and Composer.
//
// 30,000 characters holds 5 of the 6 pages captured with main-text
// extraction in full (the largest of those 5 is about 25,000). With the
// client profile added it stays well under the 100,000-character contextual
// grounding source limit, and one Analyst call uses about 32 of the 106
// grounding text units per second the account allows. Nova Pro and Haiku 4.5
// have context windows of 200,000 tokens or more, so the guardrail and cost
// set the limit, not the models.
export const RULE_WINDOW_CHARS = 30_000;

// Only code-shaped profile values are searched for: occupation, program and
// similar classification codes (41220, 52.0201). Words and dates match too
// loosely to pick out a section, and free-text fields could hold PII.
const CODE_VALUE = /^\d{4,}(\.\d+)?$|^\d{2}\.\d{2,}$/;
const SKIP_FIELDS = new Set(['rcicId', 'clientId']);

// Returns rule text that fits in maxChars. A rule that fits is returned
// whole. A longer one (a page with a long table, say) keeps its opening text
// plus every later line that contains a code from the client profile, and
// says which profile codes appear nowhere in the full text. The selection is
// a plain substring search, so the same rule and profile always give the
// same window and a replay can rebuild it.
export function ruleWindow(ruleContent: string, profile?: Record<string, unknown>, maxChars = RULE_WINDOW_CHARS): string {
  if (ruleContent.length <= maxChars) return ruleContent;

  const lines = ruleContent.split('\n');
  const needles = profileNeedles(profile);
  const found = new Set<string>();
  const matched: number[] = [];
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    const hits = needles.filter((n) => lower.includes(n.toLowerCase()));
    if (hits.length === 0) return;
    hits.forEach((n) => found.add(n));
    matched.push(i);
  });
  const missing = needles.filter((n) => !found.has(n));

  // Matched lines get up to half the window, the opening text gets the rest.
  const reserve = 600;
  const matchedBudget = Math.floor((maxChars - reserve) / 2);
  const headBudget = maxChars - reserve - Math.min(matchedBudget, matched.reduce((s, i) => s + lines[i].length + 1, 0));

  const head: string[] = [];
  let headChars = 0;
  for (const line of lines) {
    if (headChars + line.length + 1 > headBudget) break;
    head.push(line);
    headChars += line.length + 1;
  }
  if (head.length === 0) {
    head.push(lines[0].slice(0, headBudget));
    headChars = head[0].length;
  }

  const extra: string[] = [];
  let extraChars = 0;
  for (const i of matched) {
    if (i < head.length) continue;
    if (extraChars + lines[i].length + 1 > matchedBudget) break;
    extra.push(lines[i]);
    extraChars += lines[i].length + 1;
  }

  const parts = [head.join('\n'), ''];
  if (needles.length === 0) {
    parts.push(`[Excerpt: the full rule content is ${ruleContent.length} characters. The text above is its first ${headChars} characters.]`);
  } else {
    parts.push(
      `[Excerpt: the full rule content is ${ruleContent.length} characters. The text above is its first ${headChars} characters. ` +
        `The lines below are the later lines of the full rule content that contain one of these client profile values: ${needles.join(', ')}.]`,
    );
    if (extra.length > 0) parts.push(extra.join('\n'));
    if (missing.length > 0) parts.push(`[No line of the full rule content contains: ${missing.join(', ')}.]`);
  }
  return parts.join('\n').slice(0, maxChars);
}

function profileNeedles(profile?: Record<string, unknown>): string[] {
  if (!profile) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(profile)) {
    if (SKIP_FIELDS.has(k) || typeof v !== 'string') continue;
    const s = v.trim();
    if (CODE_VALUE.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}
