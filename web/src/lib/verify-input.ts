/**
 * Pulls a 64-character hex fingerprint out of whatever was pasted into
 * /verify: the bare hash, or a verify link such as
 * https://tryargus.ca/verify/<hash>, with or without a query or a trailing
 * slash. Returns it lowercased, or null when there's no single clear hash.
 */
export function extractFingerprint(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;

  // A pasted link: take the segment after /verify/.
  const fromPath = text.match(/\/verify\/([0-9a-f]{64})(?![0-9a-z])/i);
  if (fromPath) return fromPath[1].toLowerCase();

  // A bare hash, allowing the spaces receipts use to group it.
  const compact = text.replace(/\s+/g, "");
  if (/^[0-9a-f]{64}$/i.test(compact)) return compact.toLowerCase();

  // Anything else with exactly one 64-hex run in it (an email footer line, say).
  const runs = text.match(/(?<![0-9a-z])[0-9a-f]{64}(?![0-9a-z])/gi) ?? [];
  const unique = [...new Set(runs.map((r) => r.toLowerCase()))];
  return unique.length === 1 ? unique[0] : null;
}
