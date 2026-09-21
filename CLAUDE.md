# Argus project instructions

Project-scoped instructions for Claude Code and any other coding agent operating on this repo. These take precedence over defaults. Personal user preferences in `~/.claude/CLAUDE.md` still apply.

<!-- BEGIN AWS Agent Toolkit rules -->
## AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions. It provides sandboxed execution, observability, and audit logging. If unavailable, use the AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available. Load the skill with `retrieve_skill` and prefer its guidance over general knowledge.
- When uncertain about specific AWS details (API parameters, permissions, limits, error codes), verify against documentation rather than guessing. State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework principles.
- Do not use em dashes in AWS resource names or descriptions. Use hyphens instead.

## Secret Safety

MUST load the `aws-secrets-manager` skill first for any secret, credential, API key, token, or password task. MUST NOT call `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST NOT hit the Secrets Manager Agent daemon directly. MUST use `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with `asm-exec` so the secret resolves at runtime without entering context.
<!-- END AWS Agent Toolkit rules -->

## Voice

Match `~/.claude/voice-dna.md` and this repo's writing. Hard rules:
- No em dashes.
- No semicolons.
- No negative parallelisms. Banned patterns include `not X, it's Y`, `not just X but Y`, `less X, more Y`.
- Contractions, first person, active voice, digits for numbers.
- Lead with the point. Match altitude to the ask. Stop when the point is made.
- No AI slop. The full banned-word list lives in `~/.claude/voice-dna.md`. Read it before drafting any prose that will be published. Zero tolerance.

## Engineering rules for Argus

- ALWAYS use the AWS Agent Toolkit before making AWS decisions. Load `amazon-bedrock`, `aws-cdk`, `aws-serverless`, `aws-billing-and-cost-management`, `aws-auth`, `aws-storage`, or `aws-observability` as the task requires.
- NEVER guess prices. Run `scripts/pricing_lookup.py` or `aws pricing get-products` and cite the result.
- NEVER do arithmetic in prose. Write a script. Per the billing skill's deterministic-calculation rule.
- NEVER use OpenSearch Serverless. Vector search runs on S3 Vectors backing Bedrock Knowledge Bases.
- NEVER pick a Bedrock model from memory. Read `amazon-bedrock` skill's `model-selection-guide.md`, then query `aws bedrock list-foundation-models --region us-east-1`.
- ALL Bedrock invocations use cross-region inference profiles (`us.` prefix on the model ID).
- ALL Bedrock invocations set `maxTokens` explicitly. Unset defaults reserve full model max and cause silent ThrottlingException.
- The six named agents (Sentinel, Analyst, Auditor, Anchor, Composer, Recall) are separate Bedrock invocations with separate models, prompts, and tool sets. This is a Strands Graph, not an orchestrator plus tools. Agent-as-Tool pattern is banned in this repo.
- Cross-family adversarial. Analyst and Auditor MUST come from different model families. If they cannot, escalate.
- Every ImpactAssessment MUST be KMS-signed (ECDSA P-256, public JWKS endpoint). No signature, no publish.
- NO CLIENT PII IN ARGUS AT ANY LAYER. Not the model, not the application, not the database, not the logs. Client identity is an opaque `client_id` supplied by the RCIC. See design doc Section 6a. Consultant PII (their own name, email, R-license) is the only PII we hold. If a schema field or code path would ingest client names, emails, phone numbers, addresses, or DOB, escalate.
- NEVER HARDCODE IRCC SCORING THRESHOLDS OR INTERPRETATION GUIDANCE IN ANALYST PROMPTS OR CODE. Rules are first-class data, content-addressed via SHA256 in the `PolicyRules` DynamoDB table. Analyst resolves rules at assessment time via `RuleIndex`. Every `ImpactAssessment` records the rule-version hashes it used. See ADR-0001. Historical replay depends on this.
- Tests stress functionality. If a test is calibrated to pass rather than to catch a real failure, delete it.
- No hyperfocus on the 13-day countdown, and no scope creep. When in doubt, cut.
- Any architectural decision that touches Sections 6, 9, or 17 of `docs/argus-design.md` needs an ADR in `docs/adr/`.

## Escalate to the project lead before

- Adding a 7th named agent or removing any of the 6.
- Changing IaC away from CDK v2 TypeScript.
- Enabling VPC mode (Phase 2 concern).
- Merging anything into `main` from another branch.
- Making any commitment to AWS spend over CA$50 that was not in the design doc.
