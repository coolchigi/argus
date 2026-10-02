# Coding-agent-connected-to-AWS proof

These screenshots document requirement #2 of the AWS Zero to Shipped submission: proof that the coding agent driving this repo was connected to AWS. Every image is a Claude Code chat where I asked the agent to inspect the live account through the AWS MCP server. The agent's answers name real stacks, resources, and IDs that anyone with access can look up in the AWS console.

Claude Code worked against the account through the AWS MCP server (`aws-mcp`) and the AWS CLI. `aws-mcp` runs through the AWS MCP proxy (`mcp-proxy-for-aws`) under the local AWS CLI profile `aws-agent`, in account `337305803512`, region `us-east-1`.

## What each screenshot shows

**[`agent-lists-cloudformation-stacks.png`](agent-lists-cloudformation-stacks.png)**: the agent calls `aws-mcp` and returns Argus's three live CloudFormation stacks (`ArgusStatefulDev`, `ArgusApiDev`, `ArgusBudgetDev`), all `*_COMPLETE`, in `us-east-1`, with created and last-updated timestamps. It also confirms it checked all 17 enabled regions. Two of the stack descriptions it shows were out of date. The API stack's ("Step Functions orchestration") was corrected after this screenshot. The stateful stack's still reads "7 DynamoDB tables", because CloudFormation skips an update that only changes a description.

**[`agent-lists-dynamodb-tables.png`](agent-lists-dynamodb-tables.png)**: the agent enumerates the 11 DynamoDB tables inside `ArgusStatefulDev` (`argus-alerts`, `argus-audit-trail`, `argus-briefs`, `argus-client-profiles`, `argus-impact-assessments`, `argus-policy-events`, `argus-policy-rules`, `argus-public-counters`, `argus-rcic-users`, `argus-rule-index`, `argus-training-corrections`) with logical IDs and per-table status.

**[`agent-lists-cognito-kms-guardrails.png`](agent-lists-cognito-kms-guardrails.png)**: same run, continuation. The agent lists the S3 buckets, the Cognito user pool (`us-east-1_j15GauPsf`), the KMS signing key (`8b3b43ef-6d27-4193-9da8-f80c95b2dc65`, alias `alias/argus-impact-signing`), the user-provisioning Lambda, and the Bedrock Guardrail (`oddsbjwf1oot`). It also flags that the stateful stack's description didn't match what the stack held, which is the kind of detail only a live call surfaces.

## Why these count as proof

- Every resource named in the screenshots is real and lives in account `337305803512`, `us-east-1`.
- The KMS key ID `8b3b43ef-6d27-4193-9da8-f80c95b2dc65` matches the key that signs every public receipt on the [live app](https://main.d270cjhakw6y7j.amplifyapp.com). You can check a receipt in your browser at `/verify/[hash]`, and the public key is at [`/.well-known/jwks.json`](https://main.d270cjhakw6y7j.amplifyapp.com/.well-known/jwks.json).

## Screen recording

A screen recording of the same session (`Screen Recording 2026-09-30 at 2.56.09 AM.mov`) exists locally but is 560 MB, so it isn't committed. Ask for a link or a compressed version if a moving demo is needed.
