// The draft for an assessment whose Composer call the guardrail blocked
// (ADR-0006). No model writes it. A block used to drop the record, so the
// client got no brief and the consultant never heard. Nothing the blocked
// model wrote can go in, since it may hold what tripped the filter. So the
// draft says only that IRCC changed something and the consultant is checking,
// and the consultant edits it from there.

import { withCitation } from './voice.ts';

export function blockedDraft(citationUrl: string | undefined): { subject: string; bodyMarkdown: string; suggestedActions: string[] } {
  const body = [
    'IRCC has updated a page that may affect your file.',
    "I'm checking what this means for you and will follow up with you.",
  ].join('\n\n');
  return {
    subject: 'An IRCC update that may affect your file',
    bodyMarkdown: withCitation(body, citationUrl),
    suggestedActions: ['Wait for me to confirm what applies to you before you change anything on your file.'],
  };
}
