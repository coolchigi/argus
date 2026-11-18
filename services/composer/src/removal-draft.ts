// The draft for a change that only removed text. No model writes it.
//
// Told what the page no longer says, Nova Lite wrote the opposite: "the page no longer
// says you don't need an LMIA" became "you no longer need an LMIA" (measured
// 2026-11-07 on the real job offer page). The rule as it stands now isn't in what
// Composer reads, so it can't state what applies. So the draft quotes what went and
// says the consultant is checking, and they edit it from there.

import { PARTIAL_MARK, REMOVED_HEADER } from './rule-input.ts';
import { inThirdPerson, withCitation } from './voice.ts';

const MAX_QUOTED_LINES = 10;

export function removalDraft(changeText: string, citationUrl: string | undefined): { subject: string; bodyMarkdown: string; suggestedActions: string[] } {
  const at = changeText.indexOf(`${REMOVED_HEADER}\n`);
  const lines = (at === -1 ? '' : changeText.slice(at + REMOVED_HEADER.length + 1))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('(unchanged ') && !line.startsWith(PARTIAL_MARK));
  const quotable = lines.filter((line) => !line.startsWith('Section: '));
  // A removed heading with nothing under it is still what went.
  const removed = (quotable.length > 0 ? quotable : lines.map((line) => line.replace(/^Section: /, '')))
    .map((line) => inThirdPerson(line.replace(/^[-*•]\s*/, '')));

  const quoted = removed.slice(0, MAX_QUOTED_LINES).map((line) => `- ${line}`);
  const rest = removed.length - quoted.length;
  if (rest > 0) quoted.push(`- and ${rest} more lines`);

  const body = [
    `IRCC's page no longer includes this wording:\n\n${quoted.join('\n')}`,
    "I'm checking what this means for your file and will follow up with you.",
  ].join('\n\n');

  return {
    subject: 'IRCC removed wording from a page that may affect your file',
    bodyMarkdown: withCitation(body, citationUrl),
    suggestedActions: ['Wait for me to confirm what applies now before you change anything on your file.'],
  };
}
