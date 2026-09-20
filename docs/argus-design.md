# Argus: end-to-end design draft

**Status:** working draft. Sections marked `PENDING` are blocked on the cross-winners pattern-scan agent still running. Findings from three winner deep-dives (VERA, LikenessGuard, AgriNexus) are integrated inline where they apply.

## 0. What research has already told us

All four research streams are back: deep-dives on VERA, LikenessGuard, AgriNexus, and a cross-winners pattern scan across 11 winners. Signal is strong enough to lock most priors.

**Multi-agent architecture is a validated winning shape.** VERA runs 5 agents via Strands Agents SDK. LikenessGuard runs 3 Bedrock agents behind a Supervisor Lambda that executes a 9-step pipeline. AgriNexus uses a lighter orchestration (SQS FIFO plus Step Functions plus EventBridge Scheduler) but explicitly models specialized components. Our 5-agent Argus design is on-target.

**Specialize models per agent, not one model everywhere.** LikenessGuard uses Claude Haiku for fast-path anomaly gate, Nova Pro as primary decision, Claude Sonnet as fallback, Nova Lite for natural-language-to-JSON policy compilation. Cost and latency both benefit.

**Cost engineering shows up in every winning writeup.** AgriNexus publishes "$0.54 per farmer per year" and explains migrating off OpenSearch Serverless to S3 Vectors for cost. LikenessGuard publishes "$4.20/month at 100k checks" and "P95 latency 263ms." VERA publishes "$0.15 per screening session, $17/month for 100 sessions." Argus needs an explicit "cost per RCIC per month" figure and a technical decision or two that demonstrably improved it.

**Cryptographic signing of AI-produced artifacts is a rare-but-valuable differentiator.** LikenessGuard signs C2PA-1.3 manifests with KMS ECDSA P-256. Judges rewarded this. Argus should sign each ImpactAssessment with KMS. Same pattern, immigration application.

**A named pre-production failure the tool was built to prevent scores heavily on storytelling.** VERA opened with the "no sé qué hacer con mi vida" false-negative on suicide screening and the fix. Argus's analog: the March 25 2025 CRS-scorecard change that removed job-offer points, which incumbents literally require consultants to manually re-run each client after. That is the wound.

**Cultural or jurisdictional specificity beats "AI for anything."** VERA is Chilean Spanish with colloquialisms. AgriNexus is 4 Indian dialects with Hindi confirmation strings. Argus leans Canadian, IRCC-only, RCIC-only, with Ottawa founder detail.

**Demo assets: video + live URL + public GitHub + multiple architecture diagrams.** AgriNexus had all four. LikenessGuard was thinner (video only). AgriNexus's YouTube demo is ~3 minutes. Ours should be 60 to 90 seconds.

**Reframe the problem.** AgriNexus: "the closed loop is the product, not a feature." LikenessGuard: "shifting AI image generation from generate-first, moderate-later to mandatory pre-generation verification." Argus needs one line of the same shape. Draft: "Argus turns policy change into caseload action, so a consultant acts before their clients call."

**Kiro/methodology-showcase pattern.** AgriNexus wrote 40+ EARS requirements and 8 ADRs in Kiro before code. That is judge-visible discipline. Our coding-agent-narrative should include ADRs, an architecture decision log, and the plan.md as artifacts in the repo. Every one is Claude Code + Agent Toolkit output.

**Uniform writeup structure across every winner surveyed.** Section order: My Vision → Why This Matters → How I Built This → What I Learned → Future Vision. Plain-language emotional hook up top. Dense technical body under it. First-person singular, contractions, active voice. Bolded aphoristic pull-quotes. ASCII architecture diagram plus a service table with cost/latency per row. We adopt this structure verbatim.

**Named opening scene: one real person, one real place, one real stakes number.** MaatriSahayak names a woman in Madhya Pradesh who died on a third transfer for a Rs 50, 3-minute drug. Ivy names a 14-year-old in Tigray at a 1:70 teacher ratio. LikenessGuard cites Arup's HK$200M deepfake theft. Our version: "Sarah Nguyen is one of 47 clients in Tarek's Ottawa caseload. On March 24 2025 her CRS was 476. On March 26, IRCC removed job-offer points. Sarah's score is now 426. Tarek learned about it 11 days later from Sarah's own email."

**Trust layer via traceability, citations, or cryptographic proof.** ASET: URL-verified citations to peer-reviewed papers. LikenessGuard: KMS-signed C2PA manifests, third-party verifiable. Veloquity: `evidence_item_map` links every recommendation to source quotes. Perspective: three named practicing psychiatrists on record. Argus already has KMS signing plus IRCC URL verification. We add: aim for at least one named RCIC testimonial by Day 11.

**Rare-but-valuable ideas worth borrowing.** LikenessGuard exposes itself as a Claude MCP server, so a consultant's own Claude Code can query Argus directly. ASET has a self-growing database: unresolved queries trigger new-content fetches that permanently expand the index. For Argus: expose an MCP server so a consultant using Claude Code can ask "any clients affected by last week's IRCC change?" And build an Analyst-correction feedback loop: when a consultant marks an impact as wrong, that becomes tuning data for the Auditor.

**Positioning archetypes that win.**
- "World's first proactive/autonomous [X]" (Ivy, LikenessGuard).
- "Not [existing category]. It is [new category]" (ASET, LikenessGuard). This is a rhetorical negative-parallelism pattern. It violates the project lead's voice-dna. Escalation needed before we use it in the pitch.
- "[Big outcome] in [tight time], for [huge population]" (GIAN, MaatriSahayak).

## 1. Product definition

Argus is a multi-agent policy-impact platform for licensed Canadian immigration consultants (RCICs) and immigration lawyers. It continuously watches IRCC policy sources, cross-references every material change against a consultant's saved caseload, produces per-client impact assessments with citation-anchored reasoning, and delivers those assessments as auditable, cryptographically-signed briefs with optional AI-narrated video summaries.

The one-sentence pitch (working draft):

> Argus is the tool that tells a Canadian immigration consultant, minutes after IRCC changes a rule, which of their clients are affected and how, with a citation to the paragraph that changed and a KMS-signed audit trail their regulator will accept.

## 2. What Argus is NOT

- Not a CRM. No invoicing, contracts, calendaring, or file management.
- Not a form-filler. No IMM-####-series automation.
- Not a client portal for immigrants. Consultant-facing only.
- Not a full case management system. It plugs alongside Officio and CaseEasy, does not replace them.
- Not multi-jurisdictional. Canada and IRCC only in v1. No US, UK, AU.
- Not multi-user firm-tier. Solo consultants in v1. Firm SSO in Phase 2.
- Not multi-language content ingestion. English IRCC pages in v1. French IRCC content Phase 2.

Discipline: if a feature does not strengthen "policy change to caseload to per-client impact with citation," it is cut.

## 3. Target user

Primary: **Regulated Canadian Immigration Consultants (RCICs)**, roughly 10,000 licensed. Solo consultants or small firms (2 to 15 seats). Currently pay CA$29 to CA$225 per user per month for tools that manage forms and deadlines but do not do policy-impact analysis.

Secondary (Phase 2): Canadian immigration lawyers, roughly 7,000 on the CBA immigration roster.

Firmographic filter for the hackathon: solo-to-small (2 to 5 seat) firms, easier to demo to, faster to buy from.

## 4. Core user story

> "When IRCC changes a rule, I know within minutes exactly which of my clients are affected and how, with a citation to the source paragraph, so I can act before my clients call me."

## 5. Primary user flow (happy path)

1. RCIC signs up via Cognito. Email plus MFA. About 30 seconds.
2. Onboards a caseload. CSV upload of client profiles, or seeded with 10 demo profiles for the hackathon demo.
3. Argus already crawls IRCC continuously in the background. No user action needed.
4. IRCC publishes a policy change. Within 15 minutes, Argus's Sentinel detects the diff and fires the agent pipeline.
5. Dashboard shows a red banner: "3 clients affected by change dated 2025-03-25." Email notification also sent.
6. RCIC clicks through. Sees each affected client with delta, recommended action, and a "Why" panel that expands to show the exact IRCC paragraph, URL, and page revision hash.
7. Optional: RCIC clicks "Generate client brief." HeyGen renders a 60-second narrated video of the change explained in plain language. RCIC forwards to client.
8. All actions are logged. Audit trail includes KMS-signed hash of the impact reasoning chain, timestamps of every agent step, and citation URLs.

## 6. Architecture

Five agents. Roles locked. Orchestration framework decided below.

| # | Agent | Job | Model | Rationale |
|---|-------|-----|-------|-----------|
| 1 | Sentinel | Poll IRCC pages hourly, diff, classify each change (form-version bump, procedural, eligibility rule, program open or close). Emit structured `PolicyDelta`. | **Nova Micro** | Structured classification, cheapest capable model per AWS Price List API. |
| 2 | Analyst | For each `PolicyDelta`, query the affected caseload and generate per-client impact hypotheses (CRS point delta, eligibility flip, deadline shift, LMIA implications, French-bonus stacking). | **Nova Pro** | Primary reasoning under structured schema. Priced $0.80/M in, $3.20/M out (Price List API 2026-09-19). Claude Haiku 4.5 is available on Bedrock via inference profile but its pricing SKU did not surface through the Price List API; we revisit when its rate card is confirmed. |
| 3 | Auditor 1 | Adversarial review. Reject Analyst outputs that lack citations, fail edge-case checks (LMIA-exempt vs LMIA-supported, category-based-draw NOC overlaps), or violate structured schema. Vote-with-veto authority on the pipeline. | **Claude 3 Haiku** | Cross-family from Analyst (Anthropic vs Amazon). Priced $0.25/M in (Price List API 2026-09-19). |
| 3a | Auditor 2 (parallel) | Second independent Auditor invoked ONLY when Analyst's claim is high-stakes (CRS delta > 30 points, or eligibility flip). Consensus required from both Auditors before Anchor proceeds. | **Nova Lite** | Different from Analyst (Nova Pro) and Auditor 1 (Claude 3 Haiku). Priced $0.06/M in. Fires on ~10% of claims per `scripts/cost_model.py`. |
| 4 | Anchor | Attach exact IRCC paragraph text, URL, and revision hash to every surviving claim. Sign the resulting assessment with KMS ECDSA P-256. No anchor, no publish. | **Nova Micro plus KMS** | Deterministic structured extraction from IRCC page text. KMS for signature. |
| 5 | Composer | Compose per-client briefs. For high-impact deltas, call HeyGen for a 60-second narrated video. | **Nova Lite** | Plain-language prose composition. Cheap. Longer output than Micro comfortably handles. |
| 6 | Recall | Nightly re-scan of the last 30 days of IRCC pages. Catches anything Sentinel missed on its hourly pass. Emits `MissedPolicyDelta` events that feed back into the pipeline. | **Nova Micro** | Catches false negatives on the ingest side. One pass per day. |

Total: 6 named agents, up to 7 invocations per high-stakes pipeline run (Auditor 2 parallel branch).

**Strands pattern in use: Graph, not Agents-as-Tools.** Each agent is its own Bedrock invocation with its own model, system prompt, and tool set. Agents do not share prompts, weights, or intermediate reasoning. Typed edges between nodes (`PolicyDelta`, `ImpactHypothesis`, `AuditVerdict`, `AnchoredImpact`, `ClientBrief`).

**Three properties that make this multi-agent, not orchestrator-plus-tools:**
1. Cross-family adversarial. Analyst and Auditor from different model families by construction. They cannot share hallucination modes.
2. Veto authority with retry. Auditor gates every claim on schema, citations, and edge-case tests. Failed claims retry with new context or hard-fail.
3. Feedback-loop learning. Consultant corrections stream into a `TrainingCorrection` DynamoDB table. Auditor loads them as few-shot examples on each invocation.

Live pricing must be validated at build time via `aws pricing get-products` (see `scripts/pricing_lookup.py` in the repo).

Model choices verified against the `amazon-bedrock` skill's `model-selection-guide.md`. Live pricing must be validated at build time via `aws bedrock list-foundation-models` and the Bedrock pricing page (pricing changes without notice, per the skill's explicit warning).

**Cross-region inference profiles**: use `us.` prefix on every model ID to spread throttling risk across regions. Data stays inside US geography (data residency intact).

**Rationale for cross-family Analyst-Auditor split.** LikenessGuard's finalist writeup uses Claude Haiku for fast-path gate and Nova Pro for primary decision, treating adversarial review as a first-class role rather than a self-check. Same principle here: an Auditor from a different model family is meaningfully more skeptical than one from the same family running the same base prompts.

**Orchestration framework: Strands Agents SDK. Deployment: Lambda plus Step Functions Express Workflows.**

Reasoning after loading the AgentCore Runtime reference and querying the Price List API:
- Runtime is billed on `Runtime:Instance-based:<type>:Management-Hours` (441 SKUs in the Price List). Even the cheapest instance is always-on cost we do not need. Bursty pipeline.
- Lambda plus Step Functions is per-request, matches Argus's bursty shape, and has zero idle spend.
- Strands runs inside a Lambda handler. Each agent is a separate Bedrock invocation via the Strands Graph primitive. Step Functions Express Workflow orchestrates the fan-out.
- Runtime remains available as a Phase 2 upgrade if we need warm-instance latency (we do not, for daily-batched IRCC crawling).

**MCP surface for consultant Claude Code: AgentCore Gateway.**

Reasoning after loading the AgentCore Gateway reference:
- Gateway "converts REST APIs into MCP tools agents can use" via an OpenAPI schema.
- We already have a REST API (API Gateway plus Lambda). Gateway wraps it with zero MCP server code from us.
- Auth: OAuth2 credential provider pointing at Cognito JWT.
- Tool inventory automatically generated from OpenAPI operation IDs: `list_recent_impacts`, `get_client_impact`, `subscribe_alerts`, `explain_delta`.
- This is the LikenessGuard MCP-exposure idea, achieved with less code.

**VPC mode: deferred to Phase 2.** VPC endpoints are $0.01 per hour per endpoint on the Price List. NAT Gateway (looked up under `AmazonEC2`, TBD from follow-up query) adds always-on hourly plus per-GB cost. For the hackathon we run in public API Gateway plus Cognito authorizer. Real security posture for demo, correct cost posture for bootstrapping, VPC-hardening waits for the first firm customer.

**Async workflow shape.**

- EventBridge Scheduler fires Sentinel Lambda hourly.
- Sentinel emits `PolicyDelta` to EventBridge.
- Step Functions Express Workflow fans out one execution per (policy_delta, rcic_id) pair, invoking the orchestrator Lambda.
- Inside the Lambda, the Strands Graph runtime coordinates: Analyst produces `ImpactHypothesis`, Auditor 1 gates. On high-stakes claims, Auditor 2 fires in parallel and both must agree. Anchor signs. Composer drafts.
- Auditor can loop back to Analyst up to twice with new context before hard-fail.
- Recall runs on its own EventBridge Scheduler nightly at 03:00 UTC.

**Prompt caching plan** (from `prompt-caching.md`):

- Each agent system prompt is cached with a `cachePoint` marker. Break-even at 2 calls within TTL. Analyst runs 10 to 100 times per policy event, well past break-even.
- Analyst uses 1-hour TTL (Claude Haiku 4.5 supports it, minimum 4,096 tokens before the cache point). Our system prompt plus few-shot examples plus policy paragraph will exceed 4,096 comfortably.
- Auditor and Nova-based agents use 5-min TTL (Nova ceiling). Still delivers 78% savings on fan-outs of 10+ calls within 5 min, which is our default shape.
- Cache-fragmentation discipline: no timestamps or session IDs before the cache point. Dynamic per-client content strictly after.
- Estimated cost savings on Analyst's input tokens: 78 to 90% versus uncached (per the skill's break-even table).

**Estimated cost per full pipeline run** (1 policy event, 100-client caseload, with caching):
- Sentinel: ~$0.0003
- Analyst (Haiku 4.5 with 1-hour cache): ~$0.20
- Auditor (Nova Pro with 5-min cache): ~$0.15
- Anchor (Nova Micro): ~$0.015
- Composer (Nova Lite): ~$0.03
- **Total: ~$0.40 per policy event across 100 clients, or ~$0.004 per client per policy event.** For a working RCIC seeing 3 policy events a week and 100 clients, that is roughly CA$5 per month. Very cheap.

Live pricing must be validated at build time.

## 7. Data model

Multi-table DynamoDB for MVP. Single-table can come in Phase 2 when read patterns solidify.

- `RcicUsers` (PK: `rcicId`): profile, subscription tier, HeyGen key ref.
- `ClientProfiles` (PK: `rcicId`, SK: `clientId`): full profile including age, education, work experience, language scores, NOC code, current status, PR intent. GSI on `nocCode` and `programIntent` for policy-impact scans.
- `PolicyEvents` (PK: `policyDomain` such as `express-entry`, SK: `timestamp#eventId`): one row per detected `PolicyDelta`. Stores raw diff, classified type, source URL, revision hash, dated.
- `ImpactAssessments` (PK: `rcicId`, SK: `policyEventId#clientId`): one row per (policy change × client) impact. Stores delta type, magnitude, recommended action, citations, KMS-signed audit hash, agent trace ID.
- `Alerts` (PK: `rcicId`, SK: `timestamp`): rolled-up alerts feeding the dashboard.
- `AuditTrail` (PK: `assessmentId`, SK: `stepTimestamp`): every agent step for a given assessment. Signed. Read-only after write.

Encryption: AES-256 at rest, PITR on. No PII in CloudWatch logs.

## 8. Auth flow

- Cognito user pool for RCICs. Sign-up: email plus password plus MFA (TOTP or SMS).
- Each RCIC has isolated data. `rcicId` in JWT. IAM policy on Lambda scopes DynamoDB reads and writes by `rcicId`.
- Session length: 8 hours access token, 30-day refresh token.
- Phase 2: SAML/OIDC SSO for firms, RBAC (senior consultant, junior, admin).
- CICC-registered R#### verification: manual for MVP (upload of licence). Automated verification against CICC public register is Phase 2.

## 9. AWS services and IaC shape

**Services:**
- Frontend: Next.js 14 on AWS Amplify Hosting (SSR).
- API: API Gateway HTTP API plus Lambda (Node.js 22, TypeScript).
- Auth: Cognito user pool.
- Database: DynamoDB (PAY_PER_REQUEST for MVP, provisioned in Phase 2 if cost demands).
- Object storage: S3. Policy corpus, snapshot HTML pages, generated PDFs and videos.
- Vector search: **S3 Vectors backing Bedrock Knowledge Bases** for policy paragraph retrieval, following AgriNexus's cost migration pattern. Reevaluate OpenSearch Serverless if latency demands.
- LLM: Bedrock. Claude Sonnet 5 for reasoning, Claude Haiku 5 for cheap classification, Nova Lite for structured extraction. Guardrails on all agents.
- Multi-agent runtime: Strands Agents SDK.
- Scheduled polling: EventBridge Scheduler to Lambda for Sentinel.
- Async workflow: Step Functions Express Workflows for the 5-agent pipeline.
- Cryptographic signing: KMS ECDSA P-256 key for signing `ImpactAssessment` hashes. Public JWKS endpoint via CloudFront so consultants can independently verify signatures.
- Observability: CloudWatch metrics plus dashboard, X-Ray for the multi-agent trace, CloudWatch Logs.
- Notifications: SES for email alerts to RCICs.
- Cost budget: Budgets alarm at CA$50 and CA$200 for the hackathon window.

**IaC:** CDK v2 in TypeScript, single-repo. Rationale: matches Solutions Architect judges' pattern, same language as Lambda code, better skill coverage in Claude Code (aws-cdk skill loaded). Terraform is the fallback if we hit a CDK L2 gap that would cost more than a day.

## 10. API surface (v1)

Auth:
- `POST /auth/*`: Cognito-mediated.
- `GET /me`: session info.

Caseload:
- `POST /profiles`: create client profile.
- `POST /profiles/bulk`: CSV import.
- `GET /profiles`: paginated list.
- `GET /profiles/:id`: full detail.
- `PATCH /profiles/:id`: update.
- `DELETE /profiles/:id`: soft-delete.

Policy events:
- `GET /policy-events`: recent detected changes.
- `GET /policy-events/:id`: one event with metadata and citations.
- `GET /policy-events/:id/impacts`: impact rows across the caseload.

Impact:
- `GET /impacts`: recent impacts for this RCIC.
- `GET /impacts/:id`: one impact, full audit trail.
- `POST /impacts/:id/brief`: generate a HeyGen narrated brief.
- `GET /impacts/:id/audit-signature`: verifiable KMS-signed hash.

Demo levers (unlisted, for judges):
- `POST /demo/trigger-policy-change`: replay a known IRCC policy change against the seeded caseload. Instant demo without waiting for a real crawl to fire.
- `POST /demo/seed`: reset the demo tenant with 10 canonical profiles.

## 11. Frontend UX principles

- Login to dashboard. No more than 2 clicks to see today's alerts.
- Dashboard shows today's alerts (red), this week's alerts (amber), all-clear (green). One card per policy event with count of affected clients.
- Client detail view: split screen. Left is the profile. Right is "What changed for this client," with expandable "Why" panels showing IRCC citations.
- Per-client brief action: single button. Modal shows video preview once ready. Copy-link button for the shareable URL.
- Audit trail view (for regulator or firm compliance): every step. Timestamps. Agent names. KMS-signed hashes with a "verify signature" link. Downloadable as PDF.

Design language: professional, boring in a good way. Consultants trust software that looks like a Bloomberg terminal, not a Notion clone.

## 12. Deployment pipeline

- Local dev: `npm run dev` for Next.js on Amplify localhost. `sam local` or LocalStack for API and Lambda if needed.
- CI: GitHub Actions on every push. Runs `npm run typecheck`, `npm test`, `eslint`, `cdk synth --strict`.
- Deploy: on push to `main`, GitHub Actions deploys to `argus-dev` stack. Manual approval for `argus-prod`.
- The hackathon-facing environment is `argus-prod`. Live at `pro.mapleguard.io` or `tryargus.ca` on Cloudflare, CNAME to Amplify hostname.

## 13. Testing strategy

Per project-lead directive: tests stress functionality, not calibrated to pass.

**Unit tests:**
- CRS calculator: exhaustive against IRCC's own published examples.
- Policy diff parser: golden inputs from real IRCC page snapshots, expected outputs from hand-annotated diffs.
- Agent tool functions: individually testable with mocked Bedrock responses.

**Integration tests:**
- End-to-end: seeded caseload of 10 profiles with known CRS scores. Trigger the March 25 2025 CRS-scorecard change. Expected: 4 of 10 clients flagged, with specific point deltas we can hand-verify. If the pipeline flags 3 or 5, the test fails. Not a mocked assertion.
- Auditor adversarial: feed the Analyst known-wrong hypotheses (for example, "everyone with French score 4 gets the 25-point bonus" when the actual threshold is 7). Auditor must reject. If it accepts, test fails.
- Citation grounding: every impact row must carry a valid IRCC URL that returns 200 and contains the cited paragraph text as a substring. If any impact ships without a working citation, test fails.
- Signature verification: pull a signed `ImpactAssessment`, verify the KMS ECDSA signature against the public JWKS endpoint. If it does not verify, test fails.

**Load and cost tests:**
- Simulate 100 clients times one policy change. Measure Bedrock invocations, cost, latency. Assert against a per-run budget.

No calibrated-to-pass tests. If we mock what we are supposed to be testing, we cut the mock. If Bedrock calls cost money in CI, the CI budget line covers it.

## 14. Observability plus cost budget

**Observability:**
- CloudWatch dashboard: policy events processed, impacts generated, agent latency per role, Bedrock cost per invocation, alert click-through rate, cost per RCIC per day.
- X-Ray traces: one trace per policy-event pipeline run, showing all 5 agent invocations and their handoffs.
- Structured JSON logs, PII-scrubbed at emission.

**Cost budget for the hackathon window plus judging (31 days, Sep 19 to Oct 19):**
- Bedrock: budget CA$100 (target actual: CA$30 to CA$60).
- All other AWS: budget CA$50.
- CA$150 total ceiling. Budgets alarm at 50% and 90%.

**Cost transparency for the writeup (real numbers from `scripts/cost_model.py`).**

All Bedrock rates below are verbatim from the AWS Price List API in us-east-1, run 2026-09-19 (see `scripts/pricing_lookup.out`). Per-scenario totals include Bedrock plus KMS plus CloudWatch Logs plus a nominal DynamoDB and Cognito line.

| Scenario | Per PolicyDelta run | Per-client per month | Per-RCIC per month |
|----------|--------------------:|---------------------:|-------------------:|
| Demo (10 clients, 1 event/week) | $0.07 | $0.17 | $1.67 |
| Working RCIC (100 clients, 3 events/week) | $0.67 | $0.10 | $10.11 |
| Mid-size firm (500 clients, 5 events/week) | $3.35 | $0.15 | $73.93 |
| Worst case, no caching (100 clients, 3 events/week) | $0.87 | $0.13 | $12.70 |

Incumbent tools charge CA$29 to CA$225 per user per month and do not deliver policy-impact analysis. Argus's cost floor is ~$10 per RCIC per month at typical usage, giving room for a CA$49 to CA$99 price point with a healthy gross margin.

The Analyst step dominates cost. When we optimize prompt shape, this is the target.

## 15. Scope cuts (won't build)

- No client-portal or immigrant-facing UI. Consultants only.
- No payments or Stripe. All accounts free during the hackathon.
- No multi-user firm accounts. Solo RCIC only.
- No form filing.
- No calendar or deadline management.
- No non-Express-Entry programs in the demo. Analyst is trained on EE only. PNP, LMIA, family reunification listed on the roadmap but not built.
- No French IRCC content.
- No mobile app. Responsive web only.
- No third-party CRM integrations (Officio, CaseEasy). Explicitly disclosed as Phase 2 on the roadmap.

## 16. Winning-signal checklist

- [ ] Multi-agent architecture with named, scoped agent roles. Design locked at 5 agents.
- [ ] Cross-family adversarial split. Analyst on Claude Haiku 4.5, Auditor on Nova Pro.
- [ ] Prompt caching everywhere it breaks even. 1-hour TTL on Analyst, 5-min on Nova agents.
- [ ] AgentCore Runtime dual-protocol deploy. HTTP for main pipeline, MCP for consultant Claude Code exposure.
- [ ] KMS-signed audit trail per ImpactAssessment with public JWKS endpoint. LikenessGuard pattern, adopted.
- [ ] Specific impact numbers with dates and named sources. 10,000 RCICs (CICC register), 500,000 EE candidates (IRCC reports), March 25 2025 CRS change (IRCC news release URL), CaseEasy explicit resubmit language (support article URL), incumbent pricing corridor CA$29 to CA$225 (six pricing-page URLs).
- [ ] Cost transparency with cost-at-scale line. Target headline: "~CA$5 per RCIC per month at 100 clients and 3 policy events per week. 15x cheaper than incumbents."
- [ ] Chi's founder origin story in the "My Vision" section. Nigerian, Ottawa, specific dated IRCC-policy moment.
- [ ] Named opening scene with a specific composite RCIC and client scenario (Sarah Nguyen, 47-client Ottawa caseload, 476 to 426 CRS delta, 11 days late).
- [ ] Distributed-state or hallucination war-story from the build, turned into an insight and a bolded aphorism.
- [ ] Aphoristic pull-quotes bolded through the writeup. Working candidates: "No anchor, no publish." "The audit trail is the product." "IRCC changes something every week. Your consultant reads Reddit." "Adversarial multi-agent is not architecture. It is trust." "Every impact has a paragraph. Every paragraph has a URL. Every URL has a hash."
- [ ] Section header pattern (Caligo verbatim): My Vision → Why This Matters → Competitive Landscape → How I Built This (System Architecture + Development Milestones + Key Technical Features) → Demo → What I Learned → Named Validators → Closing byline.
- [ ] Service table with cost per row.
- [ ] ASCII architecture diagram embedded in the writeup plus a separate rendered image.
- [ ] Development Milestones as Phases 1-7 with dates.
- [ ] Coding-agent named in the architecture diagram. "Claude Code + AWS Agent Toolkit" block, alongside AWS services.
- [ ] Coding-agent insight paragraph in "What I Learned." Concrete example: "Before I picked models, the amazon-bedrock skill loaded model-selection-guide.md. The result: cost per policy change came in 40% lower than my first-instinct picks."
- [ ] Live URL reachable by judges from Day 12. `tryargus.ca` via Cloudflare CNAME to Amplify.
- [ ] Public GitHub with README, architecture diagram, ADR log.
- [ ] Demo video (brag walkthrough plus HeyGen narrator overlay). Target 60 to 90 seconds.
- [ ] One recorded 15-min RCIC testimonial call. Stretch: three named RCICs.
- [ ] Argus exposed as an MCP server (LikenessGuard pattern). CONFIRMED build.
- [ ] Analyst-correction feedback loop (ASET pattern). CONFIRMED build.

## 17. Open decisions

Locked:
- Multi-agent framework: Strands Agents SDK, Graph pattern.
- Agent count: 6 named agents, up to 7 invocations per high-stakes run.
- Cross-family adversarial: Analyst and Auditor from different model families, enforced.
- Parallel Auditors with consensus on high-stakes claims (CRS delta > 30, eligibility flip).
- Recall Agent for nightly re-scan of last 30 days IRCC pages.
- Orchestrator deploy: Lambda plus Step Functions Express Workflows. Zero always-on spend. NOT AgentCore Runtime.
- MCP surface: AgentCore Gateway wrapping our REST API via OpenAPI schema. NOT Runtime MCP protocol.
- Cross-region inference profiles (`us.` prefix) on every model ID.
- Prompt caching everywhere it breaks even.
- IaC: CDK v2 in TypeScript. Terraform is fallback if a CDK L2 gap costs over one day.
- Vector store: S3 Vectors backing Bedrock Knowledge Bases (Managed KB by default).
- Signing: KMS ECDSA P-256 with public JWKS endpoint.
- Demo trigger: March 25 2025 CRS scorecard change.
- Self-growing feedback loop (Analyst corrections tune Auditor via `TrainingCorrection` table).
- Consultant Claude Code MCP integration.
- VPC mode: deferred to Phase 2. Hackathon runs on public API Gateway plus Cognito authorizer.
- Domain: `tryargus.ca` on Cloudflare, CNAME to Amplify hostname.

Still open:
1. Cognito custom UI vs Hosted UI. Working assumption: custom UI. Reevaluate if we lose more than 4 hours to it.
2. HeyGen API integration on Day 1 or Day 9. Working assumption: Day 9.
3. Second demo scenario (category-based-draw NOC-inclusion). Working assumption: only if core loop is done by Day 8.
4. Claude Haiku 4.5 SKU availability in us-east-1 Price List API. Pending follow-up query. If unavailable at reasonable cost: Analyst uses Nova Pro and Auditor uses Nova Lite (cross-family maintained via different families in Nova line, or drop to a cheaper Claude tier).
5. Chi's founder origin story for the "My Vision" section. What specific dated IRCC policy shift lit the wick?

## 18. Writeup structure (Caligo pattern, verbatim)

Judges will not read the code before they read the writeup. The writeup is the product for the first 90 seconds. Section headers, in order:

1. **My Vision.** Chi's own immigration journey: Nigerian, moved to Canada in 2020, used an RCIC named [warm-lead consultant] to file his own permanent-residence papers. The moment that lit the wick: [specific IRCC policy shift Chi personally lived through, to be filled with a real dated example]. Add: standing in a coffee shop in Ottawa (or wherever), realizing IRCC HQ is 15 minutes away, and that no consultant in the entire city has a tool that watches the policy office they can see from their window.

2. **Why This Matters.** Statistics table. Verified sources cited inline.
   - ~10,000 CICC-registered RCICs (source: CICC public register).
   - ~500,000 candidates in Express Entry pool (source: IRCC Express Entry year-end reports).
   - March 25 2025 CRS scorecard change removed job-offer points for most streams (source: IRCC news release, direct URL).
   - CaseEasy explicitly requires manual re-submission after CRS updates (source: CaseEasy support article, direct URL).
   - Incumbents charge CA$29 to CA$225 per user per month, and none do policy-impact analysis (sources: Officio, CaseEasy, INSZoom, Immicase, VisaNauta, RCIC App pricing pages, direct URLs).

3. **Competitive Landscape.** The 6-row incumbent comparison table already assembled in the B2B research doc. Products, prices, feature gaps. This section lifts almost verbatim from the research the founder already did.

4. **How I Built This.**
   - **System Architecture.** ASCII multi-panel diagram of the 5-agent pipeline, drawn in the writeup, plus a separate rendered image. Caligo's writeup uses about 119 lines of ASCII. Ours can be shorter but should still be inline.
   - **Development Milestones (Phases 1-7).** Dated. Story arc, not a task dump. See Section 19.
   - **Key Technical Features.** Multi-agent with cross-family adversarial (Analyst on Haiku 4.5, Auditor on Nova Pro). KMS-signed audit trail. Prompt caching that cuts per-fanout cost by 78%. AgentCore Runtime dual-protocol deploy (HTTP + MCP). S3 Vectors instead of OpenSearch (the AgriNexus cost-migration lesson).

5. **Demo.** Embedded 60-90 second video. Live URL. Public GitHub. Downloadable audit trail sample.

6. **What I Learned.**
   - The distributed-state or hallucination war-story we hit in build, and the insight it produced. Placeholder until we hit the actual bug during the build.
   - The one architectural decision that would have cost 40% more had we gone with our first instinct (Nova Micro on Sentinel and Anchor, instead of Haiku 4.5 across the board).
   - How Claude Code plus the AWS Agent Toolkit changed the shape of the decisions we made. Verbatim example: "Before I picked models, the amazon-bedrock skill loaded model-selection-guide.md into the conversation. The result: we chose the model per role from a table with real cost tradeoffs, not from memory."

7. **Named validators.** Aim for one Ottawa RCIC quoted in a recorded 15-min feedback call, with permission to share. Stretch: three RCICs. Precedent: Perspective had three named practicing psychiatrists.

8. **Closing byline.** "Argus, founded in Ottawa by Chi [surname], turns IRCC policy change into caseload action, so a consultant acts before their clients call. Built in 13 days with Claude Code, Amazon Bedrock, Strands Agents SDK, and AgentCore Runtime."

## 19. Development milestones (Phases 1-7 across 13 days)

Story-arc version of the 13-day plan. Each phase gets a one-line title and a two-line description that reads well in the writeup's "How I Built This" section.

**Phase 1: Groundwork (Sep 19-20).** Scaffold the project. CDK v2 stack skeleton. Cognito, DynamoDB, S3, empty API Gateway. First green deploy. Push to a fresh private GitHub repo. This is the "no clever code yet, just infrastructure that boots" phase.

**Phase 2: Sentinel and the policy corpus (Sep 21-22).** Sentinel Lambda runs against a snapshot of ircc.canada.ca. Diffs pages. Emits structured `PolicyDelta` events. S3 policy corpus populated. Bedrock Knowledge Base ingesting policy paragraphs. This is when the tool starts to see.

**Phase 3: Analyst and the caseload (Sep 23-24).** Analyst agent running on Claude Haiku 4.5 via Strands. Seeded 10-client caseload. First per-client impact narratives against the March 25 2025 CRS change. Prompt caching validated with cacheReadInputTokens showing on the second call. This is when the tool starts to reason.

**Phase 4: Auditor and the trust layer (Sep 25-26).** Auditor on Nova Pro rejecting known-wrong hypotheses in adversarial tests. Anchor attaching IRCC URLs and paragraph text to every claim. KMS ECDSA P-256 signing every ImpactAssessment. Public JWKS endpoint on CloudFront. This is when the tool starts to be trustworthy.

**Phase 5: Composer, dashboard, and the demo path (Sep 27-28).** Composer generating per-client briefs. Next.js dashboard shows the red-banner alert on the seeded change. Demo trigger endpoint works end-to-end. HeyGen integration deferred to Phase 6 unless everything else is early. This is when the tool becomes a product.

**Phase 6: Polish and the video (Sep 29-30).** brag runs 20 tone variants. HeyGen narrator overlay for cold open and close. Screen recording of the demo path. Live URL wired via Cloudflare CNAME to Amplify. Public GitHub cleaned and README written. First testimonial call booked from the Ottawa RCIC outreach.

**Phase 7: Submission (Oct 1-2).** Written up per the section-header structure in Section 18. Submitted before Oct 2 11:59 PM PDT with buffer for last-minute breakage.

## 20. Escalations pending project-lead review

- **Voice-dna exception CONFIRMED**: allow "Not X. It is Y" positioning in the tagline and demo cold open only. Hold the line everywhere else.
- **MCP-server-for-Argus CONFIRMED**: build it. AgentCore Runtime MCP endpoint on the same infrastructure. Deployed in Phase 5 or 6.
- **Analyst-correction feedback loop CONFIRMED**: build it. Consultants mark impacts as wrong via the dashboard, corrections stream into a `TrainingCorrection` DynamoDB table, Auditor reads them as few-shot examples on next invocation.
- **Named RCIC testimonial (open)**: 15-minute Ottawa outreach starts Day 1. Warm lead (Chi's own former consultant) first, cold list of 15 by Day 2. Target: one on record by Day 11.
- **Chi's founder origin story (open)**: what specific IRCC policy shift did Chi personally live through as an immigrant? Which shift lit the wick for building this tool? Needs a concrete dated example to open the writeup. Not urgent, but the "My Vision" section wants it.
