# Argus: policy-impact assessments, signed and archived

**Category:** `#commercial-potential`
**Lane:** `#startup`

**Live:** https://main.d270cjhakw6y7j.amplifyapp.com
**Sample public receipt:** https://main.d270cjhakw6y7j.amplifyapp.com/verify/1cbb498541676b14a34b357c325a05c54b6c01bc3ce899c2a00acf9944f86191
**API:** https://yfc324axld.execute-api.us-east-1.amazonaws.com
**Repo:** https://github.com/coolchigi/argus

---

## The moment Argus is built for

March 25 2025. IRCC removed CRS points for arranged employment. Overnight, tens of thousands of Express Entry profiles were re-scored. If you're a Regulated Canadian Immigration Consultant (RCIC) with 60 active files, you had to figure out that week who was affected, by how many points, and what to tell each one, individually.

About 11,000 RCICs work in Canada, licensed by the College of Immigration and Citizenship Consultants (CICC). The daily workflow leans on tools like Officio or INSZoom for case management, spreadsheets for tracking, and Gmail for client comms. There's no purpose-built tool for cross-caseload policy-impact analysis. When IRCC changes a rule, they read the notice, calculate the client-by-client impact by hand, and email clients from templates. Every step is on them, and CICC Client File Management Regulation s. 7.2 requires 6 years of retention on file records they produce.

Argus does the impact analysis and drafting for them, and hands back a receipt.

## What Argus does

Argus watches IRCC. When something changes, six AI agents review the impact on the consultant's caseload, sign each assessment with a KMS-managed key, and produce a per-client email draft the consultant edits and sends. Every signed assessment lives forever with a public verification endpoint. A CICC auditor can open a link three years from now, click Verify, and confirm the record is real, in their own browser, without contacting Argus.

The six agents:

- **Sentinel** (Amazon Nova Micro) diffs IRCC pages hourly, classifies changes, snapshots the HTML to versioned S3.
- **Analyst** (Amazon Nova Pro) reasons about each client on the consultant's caseload against the rule content.
- **Auditor** (Anthropic Claude Haiku 4.5, deliberately from a different model family) adversarially reviews the Analyst's hypothesis and corrects it if needed.
- **Anchor** (AWS KMS with an ECDSA P-256 key) canonicalizes the assessment payload, SHA-256 hashes it, and signs the hash.
- **Composer** (Amazon Nova Lite) drafts the client-facing email using the opaque client identifier.
- **Recall** (Amazon Nova Micro triage) runs nightly, catches coverage gaps as caseloads grow, and backfills fresh assessments for previously-missed pairs.

Each agent is a separate Bedrock invocation with its own model, prompt, and scoped IAM. No orchestrator with tools pretending to be a pipeline.

## The design decisions that make it different from a generic AI dashboard

**Zero client PII, enforced twice.** Client identity is an opaque `client_id` the consultant picks (a case number, initials plus a serial, whatever fits their workflow). The ClientProfiles table has no name, email, phone, address, or DOB fields. Recipient email at send time gets SHA-256 hashed before persistence, and only the hash and the email domain stay. On top of the architecture, a shared Bedrock Guardrail blocks NAME, EMAIL, PHONE, ADDRESS, US_SOCIAL_SECURITY_NUMBER, CA_SOCIAL_INSURANCE_NUMBER, DRIVER_ID, CA_HEALTH_NUMBER, CREDIT_DEBIT_CARD_NUMBER, and PASSWORD entities from every model input and output. If a bad CSV import ever slips personal data into a profile, the guardrail catches it before Nova Pro sees it.

**Cross-family adversarial verification.** Analyst is Amazon Nova Pro, Auditor is Anthropic Claude Haiku 4.5. Different tokenizers, different training corpora, different failure modes. When they agree, that's meaningful signal. When they disagree, the Auditor's corrected values flow to Anchor and the corrected assessment is what gets signed. The Auditor also loads recent consultant corrections as few-shot examples on the next run, so the model measurably improves per-consultant.

**KMS-signed audit trail, verifiable offline.** Every assessment gets an ECDSA P-256 signature over a canonicalized JSON payload. The public key is exported as PEM. A public `/verify/[hash]` page runs the signature check in the visitor's browser via WebCrypto, no server round-trip. Any consultant can send the receipt link to a client or a CICC auditor, and they can confirm the record is genuine 6 years from now, with zero dependency on Argus staying alive.

**Content-addressed rule versioning.** The PolicyRules table uses `sha256(rule_content)` as the primary key. A RuleIndex table maps `(topic, effective_from)` to the current hash. When an assessment is signed, it records which rule hash it was scored against. If IRCC changes the same page next year, historical replay still works. We look up the hash the RCIC signed against, verify the assessment against the actual bytes captured, and everything is provable.

**Self-learning from consultant corrections (ASET pattern).** The consultant can file a correction on any assessment with their reasoning. The Auditor loads the last 5 corrections for that consultant's rcic_id (filtered by 90-day recency, scored by topical proximity) as few-shot examples on the next audit run. Tested end to end: submit one correction about a hypothetical 90-day IRCC transitional exemption, then trigger a fresh cascade for the same rule. The Auditor applies the exemption pattern to every affected client and correctly leaves the unaffected client alone. It picks up the pattern, and it doesn't over-generalize.

**Contextual grounding on the Analyst.** The rule content is passed to Bedrock as a `grounding_source` block. The per-client query is passed as a `query` block. The guardrail's contextual grounding filter scores the Analyst's output against the actual rule text at a threshold of 0.65. If the Analyst hallucinates a policy claim not in the rule, the guardrail flags it and the Auditor sees the failure signal.

**Citation resilience.** IRCC reorganizes canada.ca every few months. Every brief carries both the live IRCC URL and a presigned S3 snapshot URL (7-day TTL, regenerable via `GET /briefs/{id}/archive-link`). When the live URL 404s, the archive still works. The consultant's audit trail stays intact even after IRCC moves the page.

## The AWS surface

Fifteen Lambdas, all Node.js 22 ARM64: Sentinel, Analyst, Auditor, Anchor, Composer, Recall, Alerts, Briefs Service, Impacts Service, User Provisioning, plus five API placeholders. Nine DynamoDB tables, all PAY_PER_REQUEST with PITR and RETAIN. Two S3 buckets (versioned policy corpus, TTL'd generated artifacts). One HTTP API on API Gateway with a Cognito authorizer and one no-auth public route. One EventBridge default bus carrying six event types (PolicyDelta, ImpactHypothesis, AuditVerdict, AssessmentSigned via DDB stream, BriefReady, RecallDelta). One Bedrock Guardrail. One KMS ECDSA P-256 key. Amplify Hosting for the Next.js 16 frontend.

Cost model at demo scale: $1.67 per month. Cost model at working-RCIC scale (100 clients, 3 policy events per week): $10.11 per month, priced directly from the AWS Price List API. Bedrock is the dominant line item, and prompt caching drops it further at scale.

## How the coding agent shipped it

I built this with Claude Code as my pair programmer, connected to AWS through the [AWS Agent Toolkit](https://github.com/aws/agent-toolkit-for-aws) and my personal `aws-agent` named profile. The Agent Toolkit installs the AWS MCP servers Claude Code needs to talk to AWS directly (CloudFormation, DynamoDB, Bedrock, KMS, S3, SES, and more), and the same `aws login` session covers every subsequent CDK deploy. The [`.claude/settings.json`](https://github.com/coolchigi/argus/blob/main/.claude/settings.json) in the repo wires that tool surface. Every commit on `main` carries a `Co-Authored-By: Claude Opus 4.7` trailer. Running `git log --grep "Co-Authored"` in the repo returns the full record of who did what.

The build ran across seven phases across roughly two weeks:

1. Design doc, cost model, and ADRs for the two hardest choices (content-addressed rule versioning, CICC retention).
2. Sentinel: hourly IRCC diff, versioned S3 snapshots, Nova Micro classifier writing to PolicyRules + RuleIndex.
3. Analyst: EventBridge fan-out, Nova Pro per-client reasoning, ImpactHypothesis events.
4. Auditor + Anchor: Claude Haiku 4.5 adversarial review, ECDSA signing, first signed end-to-end cascade.
5. Composer + Alerts + Recall: Nova Lite drafts on the DynamoDB stream, SES dispatch for high-severity, nightly triage with Nova Micro.
6. Consultant surface: briefs service with KMS-signed batch send, self-learning corrections, multi-tenant RCIC lookup, Next.js 16 frontend on Amplify with a public `/verify/[hash]` receipt page and a marketing landing.
7. Hackathon polish: Bedrock Guardrails on every model call, contextual grounding on the Analyst, submission writeup.

Claude Code did the code. I did the direction, the trade-off calls, the design taste, and the "no, we don't need that." It's a partnership shaped like a designer working with an unusually fast senior engineer. When we hit "which model for which agent," we consulted the amazon-bedrock skill and cross-checked the AWS Price List API. When we hit "what's the CICC retention rule," we spun up a research subagent, cited the primary source, and wrote an ADR. When the UI drifted into vibe-coded shadcn territory, we spun up a design research subagent, and it produced a 470-line design brief that now governs the visual language, right down to the seal-green (`oklch(0.42 0.10 175)`) reserved only for verified state.

## What it feels like to use

Sign in with your R-license. The dashboard shows recent policy assessments as ledger entries: date, topic, opaque client chip, delta chip, signature fingerprint. Click an assessment and you get a receipt-shaped detail with the numeric delta as a hero number and a signature panel. Click Verify. A 2px seal-green bar sweeps across the top of the card over 260ms, the header cross-fades from "Signature receipt" to "Signature verified" 60ms later, the button re-labels to "Verified locally at 09:14," and the fingerprint gets a 200ms underline sweep. Real WebCrypto against the real KMS public key. No animation without a real event underneath it.

Every affected client also gets a brief drafted by Composer. Consultant edits inline with a live preview, hits Send, and gets a KMS-signed audit record of what they sent, to whom (by SHA-256 hash, not plaintext email), when. Batch send for the "IRCC just changed a rule that hits 40 of my 60 clients" case: select the rows, enter one recipient for the demo (or per-client in production), and one round-trip signs and dispatches all of them.

Every assessment includes a "File correction" affordance. The consultant explains why they think it's wrong (this reasoning field is required, the number field is optional), submits, and the Auditor learns. Next cascade shows the correction applied.

The public receipt page at `/verify/[hash]` is the surface Argus is most sharable on. Send the link to a client. Send it to CICC. The page runs the exact same 1160ms verify sequence, offline against the KMS public key, and grows a 2px seal top border when the signature clears. No login, no cookie banner, no CTA. Proof, not funnel.

## Ship gate proof

- **Live app:** https://main.d270cjhakw6y7j.amplifyapp.com (Amplify Hosting, Next.js 16 SSR)
- **Sample public receipt:** https://main.d270cjhakw6y7j.amplifyapp.com/verify/1cbb498541676b14a34b357c325a05c54b6c01bc3ce899c2a00acf9944f86191 (click Verify in the browser)
- **API:** https://yfc324axld.execute-api.us-east-1.amazonaws.com (Cognito-authorized routes plus one public `/public/verify/{hash}` route)
- **Full source:** https://github.com/coolchigi/argus (public)
- **Coding agent proof:** Claude Code was connected to AWS via the [AWS Agent Toolkit](https://github.com/aws/agent-toolkit-for-aws) from day one of the build. [`.claude/settings.json`](https://github.com/coolchigi/argus/blob/main/.claude/settings.json) in the repo shows the Agent Toolkit MCP servers wired in. Every commit on `main` carries a `Co-Authored-By: Claude Opus 4.7` trailer, so `git log --grep "Co-Authored"` returns the full record of what shipped through the coding agent.

## What's next

Argus targets one narrow market: 11,000 CICC-licensed consultants in Canada. The same mechanism (content-addressed rules, cross-family adversarial review, cryptographically-signed impact assessments, self-learning corrections) generalizes to US immigration under different licensing boards, UK and EU immigration analog, and any regulated professional-services domain where a government body publishes rules and a licensed practitioner has to explain the impact to their clients under a retention requirement. The RCIC audience is the wedge. The mechanism is the product.
