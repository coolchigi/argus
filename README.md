# Argus

Argus watches IRCC policy pages and tells a licensed Canadian immigration consultant (RCIC) which of their clients a change affects, with a KMS-signed record of why.

Built for the AWS Zero to Shipped hackathon.

Live: https://main.d270cjhakw6y7j.amplifyapp.com

## How it works

6 agents run as separate Lambda functions. EventBridge rules pass each one's output to the next, and a DynamoDB stream on the assessments table starts Composer.

| Agent | Starts on | Model | Job |
|---|---|---|---|
| Sentinel | Hourly schedule | Amazon Nova Micro | Fetches the IRCC pages in `infra/lib/ircc-watch-list.ts`, 5 at a time, and compares a SHA-256 of each page's main text with the last snapshot in a versioned S3 bucket. A page seen for the first time is stored as a baseline and emits nothing. On a change, it classifies it, stores the rule in `PolicyRules` keyed by its SHA-256, and emits a `PolicyDelta`. |
| Analyst | `PolicyDelta` | Amazon Nova Pro | For each open client the change reaches (by program and the consultant's settings), decides whether the client is affected, the impact type, a one-line narrative and a recommended action. |
| Auditor | `ImpactHypothesis` | Claude Haiku 4.5 | Checks the Analyst's answer against the rule text and up to 5 of the consultant's past corrections. Records a stance (agree, disagree or uncertain) with a reason. It can't change the Analyst's affected answer. A disagreement goes to the consultant. |
| Anchor | `AuditVerdict` | None | Builds the canonical record, hashes it with SHA-256, signs the hash with an AWS KMS ECDSA P-256 key, and writes it create-only. |
| Composer | New row in the assessments table | Amazon Nova Lite | For an affected client, drafts a brief addressed to the client, then runs code checks for grounding, dates, certainty words, internal terms and template placeholders. Findings are logged as warnings. The consultant edits every draft before it goes out. |
| Recall | Nightly at 03:00 UTC | Amazon Nova Micro | Takes rules captured in the last 30 days, asks which rule and client pairs without an assessment deserve one, and re-emits those rules as a `PolicyDelta` for the Analyst. It works from stored rules. |

After Composer, an Alerts Lambda emails the consultant through Amazon SES, once per brief, when the change is high severity or flips a client's eligibility. The SES account is still in the sandbox.

Every Bedrock call uses a `us.` cross-region inference profile, sets `maxTokens`, and goes through one Bedrock Guardrail.

For a demo, `POST /demo/trigger-policy-change` replays a stored rule as a `PolicyDelta` for allowlisted accounts, so the whole chain runs without waiting for IRCC to edit a page.

## Why you can trust a record

- **Anyone can check a signature.** The public `/verify` page checks a record's signature in the browser, no login needed. The signing key is published at `/.well-known/jwks.json`. Sent briefs are signed too.
- **2 model families.** The Analyst runs on Amazon Nova and the Auditor runs on Anthropic Claude.
- **The consultant has the final word.** When a correction flips the affected answer, Argus signs it as a new consultant-review record next to the agent's record. The agent's record never changes.
- **Records leave with the consultant.** The records export is a zip with the signed records, the public key and a `VERIFY.md` with a Node script and OpenSSL commands that check every signature offline.
- **Each step is logged.** Every agent appends one row per step to an audit table it can't edit, and the policy event page shows each agent's timing.

Clients are opaque client IDs. The caseload CSV import rejects a whole file that has a column like `name`, `email`, `phone`, `dob` or `sin`, and rejects client IDs shaped like a SIN. One exception: "Send to client" takes the client's email address at send time and sends it through SES. Argus stores only a SHA-256 hash of the address and its domain.

## Not built

These were in the plan and aren't in the code:

- Strands Agents SDK. The chain is EventBridge rules between Lambdas.
- Step Functions orchestration. A placeholder state machine and a placeholder `argus-orchestrator` Lambda from the first scaffold are still deployed and unused.
- Prompt caching.
- A second Auditor, and a retry loop between the Analyst and the Auditor.
- AgentCore Gateway and an MCP server for consultants.
- A Knowledge Base or vector search.
- Paragraph-level citations. Citations are page-level: the page URL, the archived S3 snapshot and the rule hash.
- Reads of `RuleIndex`. Sentinel writes it and no agent reads it.
- Express Entry draws and the IRCC newsroom. Those pages fill in their content in the browser, so Sentinel's HTML snapshot never changes. Draws come from a JSON file that needs its own handling.
- The weekly digest. A brief that doesn't qualify for an email gets none.
- HeyGen video briefs.

## Repo layout

- `infra/`: AWS CDK v2 in TypeScript. 3 stacks: `ArgusStatefulDev` (Cognito, the KMS signing key, the Bedrock Guardrail, 11 DynamoDB tables, 2 S3 buckets, 1 Lambda), `ArgusApiDev` (the HTTP API, 15 Lambdas, EventBridge rules and schedules) and `ArgusBudgetDev` (a cost budget).
- `services/`: one folder per Lambda, each with its own `package.json`.
- `web/`: the Next.js 15 app, hosted on AWS Amplify (`amplify.yml`). Cognito sign-in.
- `scripts/`: utility scripts, including the AWS pricing lookup, the cost model and demo seeding.
- `docs/proof/`: screenshots of the coding agent reading the live AWS account.
- `.github/workflows/ci.yml`: typecheck and tests for every package, plus `cdk synth`.

## Run the checks

Each service:

```sh
cd services/analyst
npm ci && npx tsc --noEmit && npm test --if-present
```

Web:

```sh
cd web
npm ci && npx tsc --noEmit && npm test && npx eslint
```

Infra synthesizes without an AWS account. The root `package.json` holds esbuild for bundling, and the stacks need 3 email addresses:

```sh
npm ci
cd infra && npm ci
export ARGUS_SES_FROM=you@example.com ARGUS_DEMO_RCIC_EMAIL=you@example.com ARGUS_BUDGET_EMAIL=you@example.com
npx cdk synth
```

## Built with Claude Code

The rules Claude Code works under in this repo are in [`CLAUDE.md`](CLAUDE.md). [`docs/proof/`](docs/proof/README.md) has screenshots of it reading the live AWS account through the AWS MCP server.
