# Argus performative addendum

Owner: design (extends `BRIEF.md`, does not replace it)
Status: v2 addendum, drafted for Phase 6E-v2 and Phase 6H
Voice: no em dashes, no semicolons, no negative parallelisms
Read the v1 brief first. This document assumes you already have Sections 1-12 of `BRIEF.md` in your head.

---

## 1. What "performative UI" actually is in 2026

The phrase gets used in two different ways right now, and Argus has to pick a side deliberately.

The first meaning is the practitioner tradition. Rauno Freiberg (Staff Design Engineer at Vercel, author of [Invisible Details of Interaction Design](https://every.to/p/invisible-details-of-interaction-design), maintainer of [Devouring Details](https://devouringdetails.com/), previously on Arc) writes about motion as follow-through, overlap, and staging. He borrows the Disney principles directly, and his manifesto on [rauno.me](https://rauno.me) reads "Make it fast. Make it beautiful. Make it consistent. Make it carefully. Make it timeless. Make it soulful." Emil Kowalski (Web team at Linear, author of [Sonner](https://sonner.emilkowal.ski/) and [animations.dev](https://animations.dev)) works the same seam, with essays like [You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations), [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips), and [Developing Taste](https://emilkowal.ski/ui/developing-taste). Sam Selikoff's [Framer Motion Recipes](https://buildui.com/courses/framer-motion-recipes) sits in the same lineage. This tradition treats motion as a way to make cause and effect legible: a button acknowledges you touched it, a modal signals where it came from, a list reflows so you can follow the row that just changed.

The second meaning is the satirical one. It arrived in June 2026 with [0xgosu's `performative-ui` React library](https://dev.to/0xgosu/performative-ui-when-startup-design-tropes-become-react-components-28if) and a [Hacker News thread](https://news.ycombinator.com/item?id=48445554) that lit up around it. The library catalogs the visual signals every AI startup ships: `EyebrowPill`, `LogoMarquee`, `TokenStream`, `NodeGraphBackground`, `PromptHero`, `StatCounter`. The critique, laid out by [Wasim Shaikh](https://www.wasimshaikh.com/blog/performative-ui-ai-native-react-components), is that these signals paper over an absent argument. A stat counter isn't traction. A node graph isn't an architecture. A gradient headline isn't positioning. When beauty gets cheap, decorated beauty stops meaning capability.

Both meanings are alive in the term right now. When someone on Design Twitter says "performative UI" approvingly, they mean the Rauno lineage. When someone says it as a slur, they mean the 0xgosu catalog.

Argus's answer: absorb the first, reject the second, and let the difference show. Motion in Argus has to earn its place by clarifying a real mechanism (a signature verifying, a rule hash resolving, an agent finishing). A flourish that would fit on a Series-A landing page but doesn't clarify anything on an audit surface doesn't belong here. Every proposed moment below has to pass that test.

## 2. Do / don't table for a compliance product

| Move | Belongs on Argus? | Reason |
|---|---|---|
| 260ms seal bar sweep on successful signature verify | Yes | Communicates the crypto actually ran in the browser. Extends v1 Section 8d. |
| Live-updating counter of "briefs signed on Argus today" on marketing site | Yes | Trust cue, real number, ties to KMS. Landing page only. |
| Springy card-flip on an assessment list row hover | No | Ledger entries don't flip. Reads as toy. |
| Staggered fade-in of pipeline chips as each agent completes | Yes | Makes the Strands Graph legible. Real event, real timing. |
| Particle system on the "Sign in" button | No | Consumer-app tell. Erodes trust before login. |
| Cursor-following seal glyph on the /verify hero | Maybe | Only if it stops moving during actual verification. Distraction otherwise. |
| Live citation swap when an IRCC page 404s (URL fades to archive fingerprint) | Yes | Argus's citation resilience made visible. Real event. |
| Skeleton loaders on the assessment list | No | v1 Section 10 already bans these. Data arrives pre-rendered. |
| 3D tilt on the signature receipt card | No | The receipt is an evidence artifact. Toys corrupt evidence. |
| Number-roll animation on the "assessments this month" stat | Yes, small | 400ms count-up on mount only. Never on refresh. |
| Streaming text (typewriter) on the Composer draft preview | Yes, in demo only | Sells "agents wrote this." Feature-flagged off for daily use. |
| Aurora gradient background on the landing hero | No | 0xgosu catalog. Rejects trust. |
| Gooey / liquid transitions between screens | No | Consumer app tell. |
| Follow-through on the receipt card when Verify succeeds (header rewrites 60ms after bar completes) | Yes | Rauno-style staging. Makes the moment feel choreographed, not mechanical. |

## 3. The five candidate moments

### 3a. Signature verification success (extends v1 Section 8d)

Current state: 800ms sequence with a caret ticker, a stream of the first 32 payload bytes, a 260ms seal bar sweep, a header rewrite, and a button label swap.

Proposed treatment: keep the sequence, add follow-through so the moment reads as choreographed rather than parallel.

Spec:
1. `t=0ms` button label swaps to `Verifying`, caret ticker begins (`.`, `..`, `...`, 200ms intervals).
2. `t=180ms` the payload bytes stream across the top of the card, 24 chars per 60ms in JetBrains Mono 13px, fading to `--ink-tertiary` on arrival.
3. `t=460ms` a 2px `--seal` bar animates from left to right across the card's top edge, 260ms, `cubic-bezier(0.2, 0.9, 0.3, 1)`.
4. `t=680ms` (60ms after the bar completes, follow-through) the header line cross-fades in place from `SIGNATURE RECEIPT` to `SIGNATURE VERIFIED`, 140ms opacity swap, no layout shift.
5. `t=820ms` (140ms after header, second stagger) the primary button transitions to ghost variant, label rewrites to `Verified locally at 09:14:23`, 120ms opacity crossfade.
6. `t=960ms` (final overlap) fingerprint text gets a 200ms `--seal` underline sweep, left to right.

Total moment: 1160ms. Feels like one gesture. Every stagger is 60-140ms, in the Rauno-Disney window called out in [Your UI needs more Walt Disney](https://www.uxtools.co/blog/your-ui-needs-more-walt-disney).

Justification: this is the one place v1 explicitly banked all the visible craft. Follow-through makes it read as the work of people who care, without adding decoration.

### 3b. Multi-agent pipeline visualization

Current state (v1 Section 8c): static chip row `Sentinel ▸ Analyst ▸ Auditor ▸ Anchor ▸ Composer` with durations underneath.

Proposed treatment: when a live PolicyDelta lands in the current session (Composer just produced a new brief while the consultant is watching), animate the chip row as the receipt streams in over WebSocket.

Spec:
```
Sentinel  →  Analyst  →  Auditor  →  Anchor  →  Composer
  0.4s        3.1s       2.7s       0.2s        1.9s
```
- Each chip starts at `opacity: 0.35`, in `--ink-tertiary`.
- On the WebSocket event for that agent completing, the chip cross-fades to full opacity and ink color, 220ms `cubic-bezier(0.2, 0.9, 0.3, 1)`.
- The chevron between it and the next chip fades in 80ms after the chip lands (follow-through).
- Duration number counts up in place from `0.0s` to actual, 320ms, ease-out.
- Total sequence for a fresh assessment is roughly the real pipeline time (8-12 seconds). The animation is the pipeline. No fake acceleration.

For historical assessments, the row renders in its final state with no motion. Only the live-session case gets the reveal.

Justification: this is Argus's real differentiator (six agents, cross-family adversarial). Showing the pipeline execute is the only honest way to sell the Strands Graph without the 0xgosu-style fake node graph.

### 3c. Correction picked up on next run

Current state: consultant files a correction, gets a red left rail on the row (v1 Section 10.3), and the next Auditor run silently uses it.

Proposed treatment: when the next assessment references the correction (RuleIndex resolves to the corrected version), the assessment row gets a small `↺ learned from you · 4h ago` line under it in `--seal` mono 11px. On hover, a popover shows the original correction row with a hairline connector.

Spec:
- The `↺ learned from you` line fades in on first view of that row, 180ms opacity.
- Hover on the row draws a 1px `--seal` dotted connector from the current row up to the earlier correction row, animated with `stroke-dashoffset` over 320ms, `cubic-bezier(0.4, 0, 0.2, 1)`.
- Line disappears on mouseout, 120ms fade.
- The connector never appears without a hover. No permanent visual chrome.

Justification: the correction loop is a real Argus mechanism the demo has to show. A dotted line from cause to effect makes it visible without inventing a fake ML animation.

### 3d. Empty states

Current state: v1 doesn't spec these.

Proposed treatment: three empty states get real design attention. Everywhere else, `--ink-tertiary` body copy and stop.

The three:
- **No assessments yet.** Center of viewport: hexagon glyph 48px in `--seal-subtle` fill with `--seal` stroke, 1.5px. Below in Newsreader 20px `--ink-primary`: `Nothing to review yet.` Then Inter 400 body `--ink-secondary`: `Argus starts watching IRCC the moment your first client is imported.` Ghost button: `Import your first client`.
- **No corrections filed.** Same layout. Copy: `You haven't corrected Argus yet. When you do, every future assessment on that rule cluster uses your correction.`
- **No briefs sent this month.** Same layout. Copy: `Quiet month. Your last brief went out on 2026-01-14 to client 7fa2 8e11.`

Motion: the hexagon does one thing on mount only. 400ms fill sweep from bottom to top, `cubic-bezier(0.4, 0, 0.2, 1)`. Then it stops. No pulsing, no rotation, no cursor follow.

Justification: getting these right lets Argus reject decorative empty states everywhere else.

### 3e. Live citation dies, archive takes over

Current state: v1 Section 8e specs the dual chip (live link plus snapshot). Nothing happens when the live link 404s.

Proposed treatment: on the assessment detail page, when Sentinel's next crawl finds the live IRCC URL returning 404 or a content hash diff, the live chip visibly retires and the snapshot chip promotes.

Spec:
- Live chip's `ircc.ca/study-permit ↗` gets a strikethrough that draws left to right, 400ms `ease-out`.
- Live chip fades to 40% opacity, 200ms, and its `↗` becomes a small crossed-out glyph.
- A caption appears under it in Inter 400 meta `--ink-secondary`: `Live page changed 2026-01-18. Argus still cites the version you signed against.`
- The snapshot chip's background lifts from `--seal-subtle` to `--seal` fill, 220ms cross-fade, with white ink.
- No modal. No toast. State change only.

Justification: citation resilience is a real Argus value proposition. Making the failover visible in the UI is the honest way to sell it.

## 4. The public /verify page

URL: `argus.ca/verify/[fingerprint]`. No auth. This is the surface Argus shows up on when someone shares a link, so it carries more design weight than any signed-in screen. Model it on [Stripe's hosted receipts](https://docs.stripe.com/receipts), crypto-native. The consultant sends the link to a client or CICC auditor. They open it, they see the receipt, they see the verification run in front of them.

Layout, single column, 560px wide, centered, 96px from top:

```
                       ⬢
                     argus

           SIGNATURE RECEIPT · a1b8 f2ce
           ────────────────────────────

           Study permit intake cap update
           Signed 2026-01-14 09:14:22 EST
           by Priya Sandhu, RCIC R512389
           for client 7fa2 8e11

           Fingerprint  8f2c ce41 · a19b 44d0 · e772 f108
           Key (kid)    argus-signer-2026-01
           Algorithm    ECDSA P-256 · SHA-256
           JWKS         argus.ca/.well-known/jwks.json

           IRCC pages cited
           Study permit intake cap · ircc/study-permit@a1b8f2ce
           PGWP field of study · ircc/pgwp-eligibility@e772f108

           ──────────────────────────

           [  Verify in your browser  ]

           Argus never stores client PII.
           Client identity in this receipt is an opaque
           reference chosen by the consultant.
```

Motion: page loads static. Click `Verify in your browser`, run the exact 1160ms sequence from Section 3a. When verification succeeds, the whole page background gets a single 2px `--seal` top border that persists. No login prompt, no cookie banner, no signup CTA. The page is proof, not funnel.

Below the fold: a plain-English `How verification works` block (one paragraph), the public JWKS URL rendered as a link, and a small pointer to CICC's [Client File Management Regulation](https://college-ic.ca/) as the retention reason. No related-content grid, no `Try Argus` button. Feels like a [Stripe hosted receipt](https://docs.stripe.com/receipts) or a Plaid consent screen, not a landing page.

## 5. Landing page moves for tryargus.ca

Audience: an RCIC deciding whether to log in for the first time, and a hackathon judge or investor scanning for signs the team knows what they're doing. Both want proof the product does what the top of the page claims.

**Hero.** No aurora, no node graph, no rotating headline. One Newsreader 56px line, `--ink-primary`, tracking -0.4: `Every impact assessment, signed and archived.` Under it, Inter 400 body 18px `--ink-secondary`, 480px wide: `Argus watches IRCC for you. When something changes, six AI agents review the impact on your caseload and sign the finding.` One primary button `Start with your R-license`, one ghost `See a signed sample`.

Right of the copy, a live receipt component. Real receipt, publicly signed by the Argus KMS key. The receipt's `Verify in your browser` runs on load, once, with the 1160ms sequence. Visitor sees the seal bar sweep on first paint. That's the hero animation. Real crypto against the real JWKS. Play it once, leave it verified.

**Live counter.** In small type below the fold: `4,217 briefs signed on Argus today. Last one 42 seconds ago from Toronto.` The count polls a public endpoint every 15 seconds. The number rolls (400ms count-up) only when it changes. This is the one place a `StatCounter` earns its place, because it's a real number tied to a real signing event, not a hype metric.

**How it works.** Five cards horizontal, one per agent. Each card is 200px wide, `--surface`, 1px `--border`, 6px radius. Sentinel, Analyst, Auditor, Anchor, Composer. Each card has the agent name in Inter 590 15px, a one-line role in Inter 400 body 14px, and the model family in JetBrains Mono 13px. On scroll into view, the cards fade in with a 60ms stagger between them (Disney overlap). The chevron between cards draws in with `stroke-dashoffset` right after the previous card lands. Total sequence: 600ms.

**Trust section.** This is the section a CICC auditor scrolls to. Four elements:
1. The public JWKS URL rendered as a monospace block, copyable with one click.
2. Three sample signed receipts rendered inline, each with its own working `Verify in your browser` button.
3. A hairline-bordered block quoting [CICC Client File Management Regulation s. 7.2](https://college-ic.ca/) on the 6-year retention rule, with the note `Argus keeps signed impact assessments indefinitely by default. Export on demand.`
4. The Argus KMS key rotation schedule in a small table.

**What NOT on the landing page.** No customer logo wall (Argus is 13 days old). No investor logos. No `Featured in` bar. No animated gradient wordmark. No dark hero. No pricing calculator (Phase 2). No newsletter modal. See Section 8 for the full ban list.

The hackathon demo video is the receipt verification, in the browser, in one take. That's the whole marketing story.

## 6. Motion primitives

Small set, tokenized in `web/src/lib/motion.ts` and referenced by name in every component.

Library: **[Motion](https://motion.dev/)** (package `motion`, import from `motion/react`). Framer Motion and Motion One merged in mid-2025 into a single package with a 3.8 kB core. CSS-only handles the trivial cases (hover opacity, keycap presses). Motion handles staged sequences (signature verify, pipeline reveal, citation swap).

Durations:
- `instant` 0ms. Hover states, focus rings, background changes.
- `micro` 120ms. Opacity crossfades, ghost button transitions, keycap presses.
- `short` 220ms. Chip fade-in, chevron reveal, badge state change.
- `medium` 320ms. Count-up numbers, dotted connectors, list-row inserts.
- `signature` 260ms. The seal bar sweep only, reserved.

Easings (2 curves, never a third without explicit sign-off):
- `--ease-out-soft` `cubic-bezier(0.2, 0.9, 0.3, 1)`. Arrivals, entrances, seal bar.
- `--ease-standard` `cubic-bezier(0.4, 0, 0.2, 1)`. Reversible transitions, hover swaps.

Stagger:
- `follow-through` 60ms between related elements (Disney rule from Section 3a)
- `overlap-lag` 140ms between primary and secondary elements

Distance:
- Argus doesn't slide. Motion is opacity, color, and stroke length. When something has to move, it moves 4px maximum, and only on a follow-through step. No slide-in from the side, no scale-up from 0.9. Ever.

`prefers-reduced-motion: reduce` collapses every duration above `micro` to `micro` and skips staggers.

## 7. Sound and haptics

Zero. Argus makes no sound. No haptics on mobile (Phase 2).

One exception considered and rejected: a soft `chunk` on verify success. It would land in the demo video. It would also play in the RCIC's silent office at 4pm on a Tuesday and startle them. The visual is enough.

## 8. What Argus explicitly rejects

Everything in the 0xgosu [performative-ui catalog](https://dev.to/0xgosu/performative-ui-when-startup-design-tropes-become-react-components-28if) is banned:

- `NodeGraphBackground` (aurora, blurred blobs, floating dots).
- `TokenStream` outside the Composer preview.
- `LogoMarquee`.
- `EyebrowPill` above the hero (no `Now with GPT-5`, no `Backed by Y Combinator`).
- `PromptHero` (the chat-bubble-that-types).
- `StatCounter` for anything other than the one live-signed-briefs number.
- Rotating headlines.
- Glass cards. Blur backdrops.
- Gradient wordmarks. Gradient buttons.
- Cursor-follow orbs.
- 3D tilt on cards.
- Springy list-row reordering.
- Any animation that plays on every page load rather than once per session.
- Loading spinners that persist longer than 400ms (v1 already covers this).
- Confetti. Under any circumstance.

If a component from a shadcn or Motion example folder wants to import one of these, refuse.

## 9. Phasing

**Phase 6E-v2 (this session):**
- Section 3a: extend the signature verify moment with follow-through and header cross-fade. Refactor `verify.ts` client component to sequence the stages against a shared clock.
- Section 3d: build the three empty states. Static illustration plus one mount-only fill sweep.
- Section 6: land the motion tokens file. Migrate the two existing motion sites (v1 Section 10 items 1 and 2) to use it.

**Phase 6F (next):**
- Section 3b: pipeline reveal on live session events. Requires WebSocket wiring.
- Section 3c: correction-picked-up state and hover connector.
- Section 3e: live citation retire animation. Requires Sentinel to publish `citation.changed` events.

**Phase 6H (marketing site):**
- Section 4: build the public `/verify/[fingerprint]` page as its own Next.js route on the app, not a separate site.
- Section 5: tryargus.ca as a static Next.js export, hero receipt component reused from the app.

**Deferred:**
- Sound, haptics, any dark-first landing page treatment. Phase 2 or never.

---

Conflicts with v1 to note: this addendum extends v1 Section 10 (which specced motion at three moments only) to roughly seven moments. The addendum keeps the discipline that each moment ties to a real state change or a real cryptographic event. It doesn't loosen the ban on decorative motion. If a reviewer sees a proposed animation that isn't in Section 3 or 5 of this document, treat it as out of scope and cut it.
