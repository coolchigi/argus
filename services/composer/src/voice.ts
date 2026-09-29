// A brief is an email the consultant sends to their own client. It reads as
// the consultant talking to the client: "you", "your application", "I
// recommend". Two slips break that, and both showed up in live drafts:
// - "your client", which addresses the consultant instead of the client
// - the opaque client id, which is Argus bookkeeping and means nothing to the
//   reader (the web's "Copy for my email" adds a [CLIENT NAME] greeting)

export type VoiceFinding = 'your-client' | 'client-id';

const YOUR_CLIENT = /\byour\s+client(?:'s|s)?\b/i;

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
  return findings;
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
