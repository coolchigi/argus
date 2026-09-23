# Argus design brief

Owner: design (this file is the source of truth, `globals.css` and shadcn defaults defer to it)
Status: v1.1, ready to build against. v1.1 adds the non-technical-audience guardrails and the explicit theme toggle.
Voice: no em dashes, no semicolons, no negative parallelisms

---

## 1. Positioning statement

Argus should feel like the tool an experienced Regulated Canadian Immigration Consultant reaches for when IRCC changes something and their inbox lights up. The interface reads as a working ledger with a public seal on every entry. Calm off-white canvas, graphite ink, one reserved accent for verified state, hairline rules instead of shadows. The consultant sees a stream of dated, signed impact assessments they can hand to a CICC auditor 18 months from now, next to a drafting surface for the client email they'll actually send. Nothing about it says "AI dashboard." Everything about it says "this is a record."

## 1a. Audience guardrails (added v1.1)

The primary reader of every screen is an RCIC who chose the field over software. They use ImmigrationTracker and Gmail. They will not learn a query DSL. They will not read a stack trace. They will not know what ECDSA P-256 is. They will trust "Verified" if the surface has earned it.

Rules that follow from that:

- **Crypto details live behind a `Signature details` disclosure.** The primary surface says "Signed · Verified" in plain English with the seal glyph. Fingerprint, algorithm, key id, JWKS URL, raw signature bytes all live one click deeper. Auditors and hackathon judges click through. Consultants don't have to.
- **Agent lineage chips stay visible, model IDs don't.** The chip row `Sentinel ▸ Analyst ▸ Auditor ▸ Anchor ▸ Composer` is the "five experts reviewed this" story and it reads as English. Durations stay (they read as "9 seconds"). Raw model strings like `us.claude-haiku-4-5-20251001-v1:0` are hidden behind a `How this was reviewed` toggle in the same disclosure.
- **No query DSL, ever.** The `client:7fa2 rule:study-permit@a1b8` syntax from Section 9c is removed. Filter pills and plain text search only.
- **"IRCC pages cited," not "Rule versions used."** The heading uses everyday language. The human title of the IRCC page appears first, the hash is a small caption beneath.
- **Error copy is human.** A failed verification says `This signature couldn't be verified. Something is wrong here. Please contact Argus support before relying on this assessment.` Never a raw exception on the primary surface. Raw error stays inside the Signature details disclosure for support.
- **Client id is opaque but consultant-chosen.** The consultant assigns the label at import time. Argus accepts anything short and non-personal (a case number, initials plus a serial, whatever fits their workflow). We render it in the monospace chip, but the chip's content is human-picked, not a hex hash we forced on them.
- **The theme toggle is explicit.** A three-position control in the sidebar footer: Light / Dark / System. Defaults to System. The value persists to localStorage as `argus-theme`.

The demo video shows off the crypto by clicking the disclosure open. Daily use never has to.

## 2. Design tensions

**Modern craft vs 55-year-old RCIC comfort.** Resolution: use the compact, quiet moves from Mercury and Stripe (tabular numerals, hairline borders, restrained accent) and skip the moves that read as designer-flex (light-weight display type at 300, aggressive negative tracking, hero animations, editorial serifs at 96px). Base font is 14px, not 13px. Row height is 44px, not 32px. Line-height on body is 1.55, not 1.4.

**Data density vs breathing room.** Resolution: two zones per screen. The primary work zone (assessment list, brief editor) runs dense at 44px rows with 12px vertical padding. The context zone (signature receipt panel, agent lineage sidebar) runs airy at 20-32px vertical rhythm. Never mix.

**Distinctive Argus-ness vs "another shadcn app."** Resolution: three custom surfaces get real design attention. The signature receipt card, the agent lineage badge, and the corrections diff. Everything else can look like a well-set shadcn app in a warm palette. Do not invent visual language for things that don't need it.

**Live URL vs KMS-signed snapshot for citations.** Resolution: dual chip pattern (see Section 8). The live IRCC link is styled as a normal underlined link. The signed snapshot is a monospace fingerprint chip in the seal color, with a hover state that reveals the SHA-256 and S3 key.

**Hackathon dazzle vs 6-year audit trail.** Resolution: no dazzle. The demo video sells Argus by showing a verified signature check succeed live in the browser. That's the moment. Everything else stays quiet so that moment lands.

## 3. References audit

1. **Mercury.** Take: near-monochrome canvas, single-accent restraint, cinematic empty states on the marketing side. Their product surfaces float subtly lighter than the canvas, which we're borrowing for the signature receipt card. Do not take: their cobalt (#5266eb) or their Arcadia variable weights (custom license, wrong altitude for RCICs).

2. **Ramp.** Take: hairline-bordered, shadow-free cards with 6-12px radii, tabular numerals everywhere numeric, and the discipline of a single reserved accent. Their neon-yellow (#e5fe54) is a good template for how *sparingly* an accent should appear (CTAs and live counters only). Do not take: Ramp's yellow itself (too consumer-fintech), Lausanne (custom license), or Burgess serif at display sizes (magazine-cover energy, wrong for us).

3. **Linear.** Take: three-weight typographic ladder (400 body, 510 emphasis, 590 heading), tight negative tracking on titles 20px+, and the row-list treatment where a colored dot plus small metadata does the work of a heavy badge. Do not take: Linear's dark-first palette as the default (RCICs work in daylight offices) or their command-menu density in the primary flow.

4. **Stripe (dashboard + docs).** Take: Söhne-ish grotesque plus tnum in every table cell that holds a number, ID, or hash. The ss01 alternate-a idea maps to using JetBrains Mono for anything content-addressed (signature, rule hash, model ID). Do not take: 300-weight display type (reads as fragile in an audit context).

5. **Vanta.** Take: the "passing / failing controls" mental model. Every ImpactAssessment row has a status column that reads like a compliance control, using a filled dot in seal-green for signed and verified, a hollow ring in graphite for pending, a filled dot in signal-red for correction filed. Do not take: Vanta's checklist-first onboarding (Argus users are already regulated professionals).

6. **Drata.** Take: the "test trends" widget pattern (small delta chart under a hero number, with a week-over-week percentage). We're using it for "assessments signed this month" and "corrections filed on your account." Do not take: their density-in-every-corner layout.

7. **Attio.** Take: agents as first-class UI citizens visible in the flow (we render the Sentinel / Analyst / Auditor / Anchor / Composer chain as an inline lineage row on every assessment, not buried in a debug panel). Do not take: their infinitely-configurable columns (Argus screens are opinionated).

8. **Retool.** Take: the pattern of putting a live editor and a preview side by side (used in the brief detail screen: consultant edits, rendered client-facing email updates in the right pane). Do not take: any of Retool's chrome or borders.

9. **Height.** Take: keyboard-first affordances shown as small keycap chips in metadata rows (⌘K, N, /) so power users learn them without a modal. Do not take: their density on primary lists (too tight for daylight-office reading).

10. **Modern Treasury.** Take: the "ledger entry" mental model for how a signed assessment looks in a list. Each row reads like a bank ledger line: date, counterparty (rule cluster affected), amount analog (severity), and receipt reference (signature fingerprint in mono). Do not take: their financial-services chrome.

11. **Grafana / Datadog trace view.** Take: the flame-graph-as-lineage idea, translated to the agent chain. On the assessment detail page, the Sentinel → Analyst → Auditor → Anchor → Composer chain renders as a compact horizontal timeline with duration bars and model badges. Do not take: color-per-service explosion, or the density of a real APM tool.

12. **Clio (legal practice management).** Take: the calm-authority chrome that regulated professionals recognize (serif for record titles, sans for UI, muted blue-gray for chrome). This validates our decision to lean into a "record-keeping" aesthetic rather than a "creator tool" aesthetic. Do not take: their 2015-era gradients or their dashboard-widget layout.

13. **Persona.** Take: the "verification receipt" pattern where a completed check produces a visual artifact the user can save or share. Our signature receipt card is the same idea, applied to policy-impact assessments instead of ID checks. Do not take: their consumer-facing motion.

14. **Government of Canada / IRCC pages themselves.** Take: nothing visually (they're stuck in 2012). But note: the RCIC visits IRCC pages every day. Argus should feel like a modern *counterpart* to IRCC's chrome, not a copy of it, so consultants recognize they've moved to the audit-side tool.

## 4. Design principles

1. **Every row is a ledger entry.** A row shows the date, the counterparty (rule cluster or client_id), the state, and a receipt reference. If a row can't answer "what does this prove," it doesn't belong on the primary lists. Do this: `2026-01-14 · Study permit rules · Signed · a1b8f2ce`. Not this: a card with a large avatar and three lines of description.

2. **Reserve color for state, not decoration.** Seal-green means "signed and verified in this session." Signal-red means "correction filed" or "model disagreement." Draft-amber means "pending Anchor signature." Everything else is graphite on off-white. If you're about to color a heading, stop.

3. **Hairlines over shadows.** Cards get a 1px border at `--border` and no shadow. The one exception is the signature receipt card, which gets a 1px border plus a 0.5px inner ring in seal-green to signal "this is the sealed artifact."

4. **Numbers, IDs, and hashes are monospace and tabular.** Every dollar-analog (severity score, days-to-effect countdown), every client_id, every signature fingerprint, every model version, every rule hash renders in JetBrains Mono with `font-variant-numeric: tabular-nums`. Do this: `sig fp: 8f2c ce41 · kid: argus-2026-01`. Not this: floating point severity scores in Inter Regular.

5. **The signature is the hero, once per screen.** On every screen that shows a signed artifact, exactly one signature affordance is presented full-fidelity (the receipt card). Everywhere else the signature is a compact fingerprint chip. Do not repeat the receipt card in the sidebar and the header and the footer.

6. **Consultant PII shows as text. Client identity shows as opaque chip.** The consultant's own name and R-license render as normal text ("Priya Sandhu, RCIC R512389"). Every client_id anywhere in Argus renders as a compact monospace chip on a `--muted` background ("client · 7fa2 8e11"). This visual convention *is* the zero-PII promise made legible.

## 5. Type system

**Stack.**

```css
--font-sans: "Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif;
--font-serif: "Newsreader", "Source Serif 4", Georgia, serif;
--font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;
```

Inter Variable does UI, headings, body. Newsreader appears only on the assessment detail hero title (the rule cluster name) and on pull-quote attributions inside a brief. JetBrains Mono does every hash, fingerprint, client_id, model ID, rule version, and severity number. No Söhne, no Lausanne, no Arcadia. Reasons: license-clean for hackathon, the variable-axis of Inter covers Linear-style three-weight ladders, and Newsreader supplies the "record" gravitas that Ramp's Burgess would but at the right altitude.

**Feature settings on all Inter text.** `font-feature-settings: "cv11", "ss01", "ss03";` (the humanist single-story a, straight-l, and open-4). Turns Inter into something closer to Söhne without the license.

**Numerals rule.** Wherever Inter or JetBrains Mono renders a number, an ID, or a hash: `font-variant-numeric: tabular-nums;`. Wherever Inter renders paragraph prose: `font-variant-numeric: proportional-nums;`. The two never overlap.

**Scale in px.**

| Token | px | Line-height | Tracking | Use |
|---|---|---|---|---|
| display | 32 | 1.15 | -0.4 | assessment-detail hero (Newsreader) |
| h1 | 24 | 1.2 | -0.3 | page titles (Inter 590) |
| h2 | 18 | 1.3 | -0.2 | card titles (Inter 590) |
| h3 | 15 | 1.35 | -0.1 | section labels (Inter 590 uppercase 11px alt) |
| body | 14 | 1.55 | 0 | default (Inter 400) |
| body-emphasis | 14 | 1.55 | 0 | inline emphasis (Inter 510) |
| meta | 12.5 | 1.4 | 0 | metadata rows (Inter 400) |
| micro | 11 | 1.3 | 0.4 | uppercase labels, keycap chips |
| mono | 13 | 1.4 | 0 | fingerprints, IDs, hashes (JetBrains 400) |
| mono-lg | 15 | 1.4 | 0 | signature fingerprint on receipt |

Three Inter weights only: 400 (read), 510 (emphasize / titles), 590 (page headers). No 700. No 300.

## 6. Color system

Warm off-white canvas, graphite ink, one reserved verified-state color that reads as a seal.

```css
:root {
  /* Canvas + surfaces */
  --canvas:        oklch(0.985 0.004 85);   /* warm off-white, page bg */
  --surface:       oklch(1     0    0);     /* white, cards */
  --surface-alt:   oklch(0.965 0.004 85);   /* zebra rows, chip bg */
  --surface-sunk:  oklch(0.955 0.004 85);   /* input bg */

  /* Ink */
  --ink-primary:   oklch(0.16  0.005 260);  /* body, headings */
  --ink-secondary: oklch(0.38  0.006 260);  /* metadata */
  --ink-tertiary:  oklch(0.55  0.006 260);  /* placeholder, hint */
  --ink-inverse:   oklch(0.985 0.004 85);   /* on --primary buttons */

  /* Structure */
  --border:        oklch(0.905 0.005 90);   /* hairline default */
  --border-strong: oklch(0.85  0.005 90);   /* form focus, table header underline */
  --divider:       oklch(0.93  0.004 90);   /* between list rows */

  /* Seal (reserved for signed + verified state, ONLY) */
  --seal:          oklch(0.42  0.10 175);   /* dense teal-green, wax-seal analog */
  --seal-ink:      oklch(0.985 0.004 85);   /* on seal fills */
  --seal-subtle:   oklch(0.94  0.03 175);   /* seal chip background */
  --seal-ring:     oklch(0.55  0.09 175);   /* inner ring on receipt card */

  /* State */
  --amber:         oklch(0.72  0.14 75);    /* pending Anchor, draft */
  --amber-subtle:  oklch(0.955 0.05 80);
  --red:           oklch(0.50  0.19 27);    /* correction filed, disagreement */
  --red-subtle:    oklch(0.955 0.04 27);
  --violet:        oklch(0.52  0.14 285);   /* Recall backfill only, rare */

  /* Primary (button ink, near-black, NOT the seal) */
  --primary:       oklch(0.18  0.008 260);
  --primary-hover: oklch(0.10  0.008 260);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --canvas:        oklch(0.145 0.006 260);
    --surface:       oklch(0.175 0.006 260);
    --surface-alt:   oklch(0.20  0.006 260);
    --surface-sunk:  oklch(0.155 0.006 260);
    --ink-primary:   oklch(0.965 0.005 85);
    --ink-secondary: oklch(0.72  0.005 85);
    --ink-tertiary:  oklch(0.55  0.005 85);
    --border:        oklch(0.28  0.006 260);
    --border-strong: oklch(0.35  0.006 260);
    --divider:       oklch(0.22  0.006 260);
    --seal:          oklch(0.60  0.11 175);
    --seal-subtle:   oklch(0.24  0.05 175);
    --seal-ring:     oklch(0.65  0.10 175);
    --primary:       oklch(0.95  0.005 85);
    --primary-hover: oklch(1     0    0);
  }
}
```

**Justification of the seal hue.** Mercury reserved cobalt, Ramp reserved chartreuse, Linear reserved indigo. A dense teal-green (H175 at L0.42) reads as "verdigris on bronze," which is the visual language of court seals and archival stamps. It's far enough from cobalt to not read as Mercury, far enough from Ramp's yellow to not read as fintech, and it stays legible on both canvas and dark surface. This color appears only on: verified state, signed row indicators, the receipt card ring, and the "verify in browser" success state. It is not a brand color for logos or marketing.

## 7. Layout and spacing

**Grid.** 12-column on desktop, 8px baseline. Container max 1240px. Sidebar 240px on the app shell, 320px for the assessment detail's right-hand receipt panel.

**Gutters.** 24px between primary sections, 16px between cards inside a section, 12px between list rows.

**Row height.** 44px default. 56px for the two-line ledger entry (title line + metadata line). 36px only for dense settings tables.

**Padding.** Cards: 20px 24px. Inputs: 8px 12px. Buttons: 10px 16px. Chips: 4px 8px. Receipt card: 32px 32px (airy).

**Rule for borders vs whitespace vs dividers.**
- Between rows inside a list: 1px `--divider` (never `--border`)
- Between cards: 24px whitespace, no divider
- Around a card: 1px `--border`, radius 6px
- Around the receipt card only: 1px `--border` + 1px inset `--seal-ring`, radius 8px
- Between a form label and its input: 6px whitespace
- Never a shadow. If you need elevation, use `--surface` on `--canvas`.

## 8. Signature-specific patterns

This section is Argus. Get these three right and the rest can be a well-set shadcn app.

### 8a. Signed row indicator

Each ImpactAssessment row on the assessments list carries a compact state cluster in the leftmost column:

```
● SIGNED    a1b8f2ce · us.claude-haiku-4-5
○ PENDING   awaiting Anchor · 0m 42s
● CORRECT   f2e19a03 · consultant reviewed 2h ago
```

- `●` filled dot 8px in `--seal` for signed, `--red` for correction filed
- `○` hollow ring 8px 1px in `--ink-tertiary` for pending
- Label in Inter 510 micro (11px uppercase, tracking 0.4)
- Fingerprint in JetBrains Mono 13px, first 8 hex chars of the ECDSA signature SHA-256, split as `xxxx xxxx` for scannability
- Model ID (Analyst's model) in `--ink-secondary` monospace after a middot

Row itself never gets a background color. State lives in the dot and the fingerprint.

### 8b. Signature receipt card

Appears once per assessment detail page, right column, sticky at 88px from top. This is the artifact a consultant would screenshot for an audit review.

```
┌───────────────────────────────────────────┐  ← 1px --border + 1px inset --seal-ring
│  ⬢ SIGNATURE RECEIPT                       │  header: seal hexagon 14px + Inter 590 micro
│  ─────────────────────────────────────    │
│                                            │
│  Fingerprint                               │  meta label Inter 510 micro
│  8f2c ce41 · a19b 44d0 · e772 f108        │  mono-lg, tabular, three groups of 8
│                                            │
│  Signed at   2026-01-14 09:14:22 EST      │  Inter 400 body, tabular
│  Key (kid)   argus-signer-2026-01          │  mono 13px
│  Algorithm   ECDSA P-256 · SHA-256         │  Inter 400 meta
│  JWKS        argus.ca/.well-known/jwks.json│  underlined link
│                                            │
│  Rule versions used                        │  Inter 510 micro
│  ircc/study-permit@a1b8f2ce                │  mono 13px, one per line
│  ircc/pgwp-eligibility@e772f108            │
│                                            │
│  ─────────────────────────────────────    │
│  [  Verify in your browser  ]              │  full-width button, --primary
│  [  Download signed payload (.jws)  ]      │  full-width, ghost variant
└───────────────────────────────────────────┘
```

- Card background is `--surface`, never sunk
- Header hexagon glyph is inline SVG in `--seal`, filled
- The `Verify in your browser` button runs WebCrypto against the JWKS on click (see Section 10 for its animation), no server round-trip
- On success, the card grows a subtle bar at the top edge in `--seal`, 2px tall, and the header line changes to `⬢ SIGNATURE VERIFIED · a1b8f2ce · 9:14:22 EST · your browser`
- On failure, red bar and `⬢ SIGNATURE INVALID` in `--red`, plus the raw error under it in monospace. No modal.

### 8c. Agent lineage badge

Inline on the assessment detail hero, one row under the title, and repeated at 60% scale on hover of any list row.

```
Sentinel ▸ Analyst ▸ Auditor ▸ Anchor ▸ Composer
  0.4s      3.1s     2.7s     0.2s     1.9s
  nova-lite nova-pro haiku-4-5 kms      haiku-4-5
```

- Each agent name is Inter 510 micro
- Chevron `▸` in `--ink-tertiary`
- Duration line in JetBrains Mono 13px tabular
- Model line in `--ink-secondary` mono 13px
- When Recall backfilled a step, that segment's chevron and label render in `--violet` and a small `↺` glyph appears before the agent name
- Cross-family divergence between Analyst and Auditor is asserted visually: if the two model rows would be in the same family, the whole badge shows a `--red` outline and the tooltip reads `cross-family invariant violated`

### 8d. Verified-in-browser success state

Live in the demo video. Sequence, over ~800ms:

1. Button label changes to `Verifying...` and a JetBrains-Mono 13px caret cycles `.` `..` `...` at 200ms intervals (three frames, no easing)
2. The signed payload's first 32 bytes stream across the top of the card in monospace, then fade to `--ink-tertiary`
3. The 2px `--seal` bar animates in from left-to-right, 260ms `ease-out`
4. Header line rewrites in place to `⬢ SIGNATURE VERIFIED`
5. Button becomes ghost variant labeled `Verified locally at 09:14:23`

This is the money shot for the hackathon demo. It's the only place motion earns its keep.

### 8e. Citation dual chip

Every bullet in an assessment brief that cites an IRCC page carries two chips:

```
[ ircc.ca/study-permit ↗ ]  [ snapshot · 8f2c ce41 ↓ ]
```

- Live link chip: Inter 510 meta, underlined, `↗` glyph in `--ink-tertiary`
- Snapshot chip: JetBrains Mono 13px on `--seal-subtle` background, `↓` for download
- Hover on snapshot reveals a small popover with full SHA-256, S3 key, and captured-at timestamp

## 9. Screen layouts

Ascii is indicative, not literal. Numbers are the real spacing.

### 9a. Login (`/login`)

Single-column centered card, 400px wide, 96px from top.

```
                    ⬢
                  argus
        Impact assessments,
         signed and archived.
     ────────────────────────

     Email
     [ priya@sandhu-immigration.ca ]

     [    Sign in with passkey    ]
     [       Use a password       ]

     ────────────────────────
     R-license number
     R512389
     CICC verified · signed in from Toronto
```

- Hexagon glyph 32px in `--seal`
- Wordmark in Newsreader 24px `--ink-primary`
- Tagline in Inter 400 body `--ink-secondary`
- Passkey primary, password ghost
- The R-license line is present at sign-in, in Inter 400 meta. Consultants recognize their license number. This is a trust cue, not decoration.

### 9b. Dashboard (`/`)

Two-column: left is a vertical stream of the last 20 signed assessments (ledger), right is a stat rail.

```
┌─────────────────────────────────────────────┬────────────────────┐
│ RECENT ASSESSMENTS               view all → │ THIS MONTH         │
│ ────────────────────────────────────────── │ ────────────────── │
│ ● 2026-01-14  Study permit cap update       │ 47                 │
│    client · 7fa2 8e11  ·  sig a1b8 f2ce     │ assessments signed │
│ ● 2026-01-14  PGWP field-of-study revision  │ +12% vs 30d ago    │
│    client · 3c19 04ab  ·  sig e772 f108     │                    │
│ ● 2026-01-13  LMIA processing time change   │ ────────────────── │
│    client · 9f01 b74c  ·  sig 4a90 22de     │ 3                  │
│ ○ 2026-01-13  Express Entry draw notice     │ corrections filed  │
│    client · 7fa2 8e11  ·  pending Anchor    │ ────────────────── │
│                                             │ 12                 │
│                                             │ clients watching   │
└─────────────────────────────────────────────┴────────────────────┘
```

- Rows 56px, `--divider` between
- Stat block: hero number in Inter 590 32px tabular, label in Inter 400 meta uppercase 11px, delta in Inter 510 meta `--seal` for positive, `--red` for negative
- No charts on the dashboard. Argus is not an analytics tool. The delta number is the whole chart.

### 9c. Assessments list (`/assessments`)

Full-width table, 1240px, sticky header at 64px.

Columns: `state · date · rule cluster · client · severity · signed by · fingerprint`

- Header row: Inter 510 micro uppercase, underline `--border-strong` 1px
- Body rows: 44px, `--divider` between, `--surface-alt` on hover (not on the whole row, only at the leftmost 4px which grows into a rail)
- Severity column: horizontal bar 4px tall, width proportional, in `--ink-primary`. No color coding on severity. Severity is a magnitude, not a state.
- Filter bar above table: pill toggles for `Signed · Pending · Corrections`, plus a search input that accepts `client:7fa28e11` and `rule:study-permit@a1b8` syntax
- Row click opens detail. No modal.

### 9d. Assessment detail (`/assessments/[id]`)

Two-column split, 800px left, 320px right.

```
┌────────────────────────────────────────┬──────────────────────┐
│  Study permit intake cap update         │  ⬢ SIGNATURE RECEIPT │
│  Effective 2026-02-01 · IRCC OB 2026-3  │  (see 8b)            │
│                                         │                      │
│  Sentinel ▸ Analyst ▸ Auditor ▸ ...     │                      │
│  (agent lineage badge, see 8c)          │                      │
│                                         │                      │
│  IMPACT SUMMARY                         │                      │
│  Two of your 12 watched clients are     │                      │
│  affected. See recommended actions      │                      │
│  under each client.                     │                      │
│                                         │                      │
│  ─ client · 7fa2 8e11                   │                      │
│  Delay expected: 2-4 weeks              │                      │
│  Recommended: reissue LOA before Feb 1  │                      │
│  Rule cited: ircc/study-permit@a1b8f2ce │                      │
│  [ ircc.ca/... ↗ ] [ snapshot · 8f2c ↓ ]│                      │
│                                         │                      │
│  ─ client · 3c19 04ab                   │                      │
│  ...                                    │                      │
│                                         │                      │
│  ─────────────────────────────────      │                      │
│  FILE A CORRECTION                      │                      │
│  Reasoning [textarea, 4 rows]           │                      │
│  Corrected classification [select]      │                      │
│  [ Submit correction ]                  │                      │
└────────────────────────────────────────┴──────────────────────┘
```

- Title Newsreader 32px `--ink-primary`
- Effective date Inter 400 body `--ink-secondary` tabular
- Client blocks separated by 24px whitespace and a 1px `--divider`
- Correction form is Inter 400 body throughout. Submitting adds a row to the assessment's own audit trail visible below the form as a chronological list.

### 9e. Brief detail with editor and send (`/briefs/[id]`)

Two-panel side-by-side. Left is a plain-text editor for the consultant, right is the rendered client-facing email preview. A bottom bar carries recipient chip and send controls.

```
┌───────────────────────────┬─────────────────────────────────┐
│ EDITOR                    │ PREVIEW · what your client sees │
│ ────────────────────────  │ ──────────────────────────────  │
│ Dear {{first_name}},      │ Dear Aditya,                    │
│                           │                                 │
│ IRCC updated the study    │ IRCC updated the study permit   │
│ permit intake cap on      │ intake cap on 2026-02-01, and   │
│ 2026-02-01, and this      │ this affects your file. Below   │
│ affects your file. Below  │ is what we recommend.           │
│ is what we recommend.     │                                 │
│                           │ Reissue your Letter of          │
│ [assistant suggestion:    │ Acceptance before Feb 1...      │
│  add citation to OB       │                                 │
│  2026-3]  accept  dismiss │ – Priya Sandhu, RCIC R512389    │
└───────────────────────────┴─────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ Recipient  client · 7fa2 8e11 · resolves to hashed email   │
│ Signature will be recorded, recipient email hashed on send  │
│                                                              │
│ [  Send  ]   [ Save draft ]   [ View diff from Composer ]   │
└──────────────────────────────────────────────────────────────┘
```

- Editor left, preview right, both 50% width, 500px min height
- Recipient bar: 44px, `--surface-alt` background, monospace client_id chip, plain-text disclosure that the email is hashed post-send
- Send button in `--primary`, no color, no icon. Sending fires a signed audit entry attached to the brief and shows a `mailed 09:14:22 · fp a1b8 f2ce` line in the recipient bar within 300ms.

## 10. Motion and microinteractions

Argus is a records tool. Motion is used three times only.

1. **Verify-signature success** (see 8d). The seal bar sweep is the one moment of visible flourish.
2. **New assessment lands on the dashboard.** When Composer produces a new brief in-session, the top row of the dashboard stream fades in over 200ms and shifts the list down by its height in 200ms `ease-out`. No slide-in from the side. No color pulse.
3. **Correction saved.** The row grows a 2px `--red` left rail that persists (state change, not animation). 100ms fade-in on the rail.

Everything else is instant. Hover states are opacity or background changes with 0ms transition. No skeleton loaders on primary flows: server-rendered data arrives before the user does. Suspense fallbacks use a 1px `--seal` progress line at the top of the viewport, iOS-style.

## 11. Iconography

Lucide, 16px default, 1.5px stroke, `--ink-secondary` color. Larger only in empty states (32px, `--ink-tertiary`). Icons appear in three places only:

1. Nav rail (dashboard, assessments, briefs, corrections, settings)
2. Chevron `▸` and `↗` inside agent lineage and citation chips
3. Buttons that repeat frequently enough to earn a glyph (`copy fingerprint`, `download .jws`)

The seal hexagon `⬢` is custom SVG, not from Lucide, and is used only for signature affordances. Never inside a button.

No icon on primary CTAs. No icon on nav item labels next to the icons (the label is Inter 400 meta). No decorative icons at the top of empty-state cards.

## 12. Things to explicitly avoid

- **Heavy shadows or elevation.** Reads as a mid-2010s Material clone. Use hairlines.
- **Rounded corners over 8px.** Reads as consumer, wrong for a ledger. Cards 6px, inputs 4px, chips 4px, receipt card 8px, buttons 4px. Never 12px+.
- **Emoji anywhere in the UI.** Not in empty states, not in success toasts, not in agent avatars. This is a legal record.
- **Gradients.** Not on buttons, not on hero backgrounds, not on charts.
- **Blue accents.** Reads as generic B2B SaaS. Our accent is the seal-green. Blue is the color of an unstyled link.
- **Glassy blur backgrounds.** Reads as consumer OS chrome. Cards are solid `--surface`.
- **Skeuomorphic wax-seal illustrations.** The hexagon glyph is enough. A drawn wax seal would kill the credibility.
- **Toast notifications as the primary feedback for a signed event.** Signing is a state change. It gets recorded in the receipt card and the audit trail, not in a corner toast that vanishes.
- **Chart library defaults (Recharts blue palette, Chart.js gray grid).** If we ever need a chart, style it against this palette from scratch.
- **Undo affordances on signed rows.** You cannot undo a signature. Do not offer the button.
- **Marketing-page hero animation on a signed-in surface.** The consultant is here to work.
- **Client-side agent status spinners that suggest waiting.** Assessments are async and pre-signed by the time the consultant opens them. The UI shows history, not a loading state.
- **The word "Powered by" anywhere.** Argus is the record.

---

## Implementation notes for the build

- Keep `src/app/globals.css`'s existing `--brand` token but rename the internal semantic to `--seal`. Add `--seal-ring` and `--seal-subtle`.
- Set `font-feature-settings: "cv11", "ss01", "ss03"` on `body`, and `"tnum"` on `[data-tabular]`, `code`, `.mono`, `.fingerprint`.
- Load Inter Variable and Newsreader from `next/font/google`. JetBrains Mono is already wired as `--font-plex-mono`, rename to `--font-mono` and load JetBrains Mono instead.
- shadcn `Card`, `Button`, `Badge`, `Input`, `Separator` are the base. Override defaults in `components/ui/*` to match Sections 5-7. Do not create new component primitives except for the three in Section 8 (`SignatureReceipt`, `AgentLineage`, `CitationChips`).
- The signature verification in Section 8d uses WebCrypto SubtleCrypto against the public JWKS. That utility lives in `lib/verify.ts` and is called from the client component that renders the receipt card.
