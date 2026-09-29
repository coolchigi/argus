// Pure helpers for the brief screens. No React, so node --test covers them.

/** The token a consultant replaces with the client's real name in their own mail client. */
export const CLIENT_NAME_TOKEN = "[CLIENT NAME]";

/**
 * A brief is delivered once Argus sent it or the consultant copied it out.
 * Either clears the action. Mirrors isDelivered in the policy-events service.
 */
export function isDelivered(status: string | null | undefined): boolean {
  return status === "sent" || status === "sent-externally";
}

export type CopyInput = {
  subject: string;
  body: string;
  actions: readonly string[];
  clientId: string;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Composer writes the opaque client id where a name would go. Swap it for the token. */
function tokenize(text: string, clientId: string): string {
  const id = clientId.trim();
  if (!id) return text;
  return text.replace(new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(id)}(?![A-Za-z0-9_-])`, "g"), CLIENT_NAME_TOKEN);
}

/**
 * What "Copy for my email" puts on the clipboard: a subject line, the body
 * and the suggested actions, with every mention of the client id swapped for
 * [CLIENT NAME]. A body with no token gets a greeting line that carries it,
 * so the consultant always has one place to type the name.
 */
export function buildCopyText({ subject, body, actions, clientId }: CopyInput): string {
  const s = tokenize(subject.trim(), clientId);
  let b = tokenize(body.trim(), clientId);
  if (!b.includes(CLIENT_NAME_TOKEN)) b = `Hi ${CLIENT_NAME_TOKEN},\n\n${b}`;
  const parts = [`Subject: ${s}`, "", b];
  const list = actions.map((a) => a.trim()).filter(Boolean);
  if (list.length > 0) parts.push("", "Suggested actions:", ...list.map((a) => `- ${a}`));
  return parts.join("\n");
}

// First letter either case. The rest of the pattern is case-sensitive so a
// name has to start with a capital.
export type BatchRowStatus = "pending" | "signing" | "sent" | "failed";
export type BatchRowState = { status: BatchRowStatus; error?: string };
export type SendResult = { briefId: string; ok: boolean; sentBodyHash?: string; error?: string };

const SEND_ERRORS: Record<string, string> = {
  "brief-already-sent": "Already sent",
  "brief-not-found": "Brief not found",
  "missing-briefId-or-recipient": "No recipient",
};

export function describeSendError(code: string | undefined): string {
  if (!code) return "Send failed";
  if (SEND_ERRORS[code]) return SEND_ERRORS[code];
  // SES refuses unverified recipients while the account is in the sandbox.
  if (/not verified|MessageRejected/i.test(code)) return "Email provider refused the address";
  return "Send failed";
}

/**
 * Per-row outcome of POST /briefs/batch-send, from its `results` array. A
 * selected brief the API didn't report on is marked failed, never sent.
 */
export function batchStatesFromResults(ids: readonly string[], results: readonly SendResult[]): Record<string, BatchRowState> {
  const byId = new Map(results.map((r) => [r.briefId, r]));
  const out: Record<string, BatchRowState> = {};
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) out[id] = { status: "failed", error: "No result returned" };
    else if (r.ok) out[id] = { status: "sent" };
    else out[id] = { status: "failed", error: describeSendError(r.error) };
  }
  return out;
}

const GREETINGS = ["hi", "hello", "hey", "dear", "good morning", "good afternoon", "good evening", "bonjour", "salut"]
  .map((g) => `[${g[0].toUpperCase()}${g[0]}]${g.slice(1)}`)
  .join("|");
const TITLES = ["mr", "mrs", "ms", "mx", "dr"].map((t) => `[${t[0].toUpperCase()}${t[0]}]${t.slice(1)}`).join("|");
// Words that can follow a greeting without being a name.
const NOT_NAMES = new Set(["there", "all", "everyone", "team", "again", "client", "sir", "madam", "friend", "folks"]);

/**
 * A greeting followed by a capitalised word, like "Dear Priya" or "Hi Mr. Sandhu".
 * Returns the matched greeting so the warning can quote it, or null. It's a
 * heuristic: it only looks at greetings, and it lets the token and the client
 * id through.
 */
export function findNamedSalutation(text: string, clientId = ""): string | null {
  const re = new RegExp(`(?:^|[\\n.!?]\\s*)((?:${GREETINGS})[ \\t,]+(?:(?:${TITLES})\\.?[ \\t]+)?(\\p{Lu}[\\p{L}\\p{N}'_-]+))`, "gu");
  for (const m of text.matchAll(re)) {
    const word = m[2];
    if (NOT_NAMES.has(word.toLowerCase())) continue;
    // File numbers carry digits. Names don't.
    if (/\p{N}/u.test(word)) continue;
    if (clientId && word === clientId) continue;
    return m[1];
  }
  return null;
}
