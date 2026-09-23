/**
 * Argus motion tokens. See web/design/PERFORMATIVE.md Section 6.
 *
 * Discipline: opacity, color, and stroke-length only. Argus doesn't slide.
 * When something has to move, it moves 4px maximum, only on a follow-through
 * step. Every motion here ties to a real state change or a real
 * cryptographic event.
 */

export const DURATIONS = {
  instant: 0,
  micro: 120,
  short: 220,
  medium: 320,
  signature: 260, // Reserved for the seal-bar sweep only.
} as const;

export const EASINGS = {
  outSoft: [0.2, 0.9, 0.3, 1] as const,
  standard: [0.4, 0, 0.2, 1] as const,
};

export const STAGGERS = {
  followThrough: 60,
  overlapLag: 140,
} as const;

/**
 * Signature verification sequence timing. Section 3a of the performative
 * addendum. Total moment: 1160ms. Feels like one gesture.
 */
export const VERIFY_TIMELINE = {
  caretStart: 0,
  bytesStreamStart: 180,
  sealBarStart: 460,
  sealBarDuration: DURATIONS.signature, // 260ms
  headerRewriteStart: 460 + DURATIONS.signature - 40, // slight overlap
  headerRewriteDuration: 140,
  buttonRewriteStart: 460 + DURATIONS.signature + STAGGERS.overlapLag, // ~860ms
  buttonRewriteDuration: DURATIONS.micro,
  fingerprintUnderlineStart: 960,
  fingerprintUnderlineDuration: 200,
  totalDuration: 1160,
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
