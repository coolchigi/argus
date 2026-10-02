# Coding-agent-connected-to-AWS proof

These screenshots document requirement #2 of the AWS Zero to Shipped submission: proof that the coding agent driving this repo was connected to AWS. Every image is a Claude Code chat where I asked the agent to inspect the live account through the AWS MCP server. The agent's answers name real stacks, resources, and IDs that anyone can look up in the AWS console.

The AWS MCP servers are wired into this repo through [`.claude/settings.json`](../../.claude/settings.json), installed via the [AWS Agent Toolkit](https://github.com/aws/agent-toolkit-for-aws), and authenticated under the local `aws-agent` profile.

## What each screenshot shows

**[`agent-lists-cloudformation-stacks.png`](agent-lists-cloudformation-stacks.png)**: the agent calls `aws-mcp` and returns Argus's three live CloudFormation stacks (`ArgusStatefulDev`, `ArgusApiDev`, `ArgusBudgetDev`), all `*_COMPLETE`, in `us-east-1`, with created and last-updated timestamps. It also confirms it checked all 17 enabled regions.

**[`agent-lists-dynamodb-tables.png`](agent-lists-dynamodb-tables.png)**: the agent enumerates the 11 DynamoDB tables inside `ArgusStatefulDev` (`argus-alerts`, `argus-audit-trail`, `argus-briefs`, `argus-client-profiles`, `argus-impact-assessments`, `argus-policy-events`, `argus-policy-rules`, `argus-public-counters`, `argus-rcic-users`, `argus-rule-index`, `argus-training-corrections`) with logical IDs and per-table status.

**[`agent-lists-cognito-kms-guardrails.png`](agent-lists-cognito-kms-guardrails.png)**: same run, continuation. The agent lists the S3 buckets, the Cognito user pool (`us-east-1_j15GauPsf`), the KMS signing key (`8b3b43ef-6d27-4193-9da8-f80c95b2dc65`, alias `alias/argus-impact-signing`), the user-provisioning Lambda, and the Bedrock Guardrail (`oddsbjwf1oot`). It also flags a mismatch between the stack description and reality, which is exactly what a real AWS MCP call would surface.

## Why these count as proof

- Every resource named in the screenshots is real and inspectable in the account under IAM identity `arn:aws:iam::337305803512:user/aws-agent`.
- The KMS key ID `8b3b43ef-6d27-4193-9da8-f80c95b2dc65` matches the key that signs every public receipt on the [live app](https://main.d270cjhakw6y7j.amplifyapp.com), verifiable in-browser at `/verify/[hash]`.
- The `git log --grep "Co-Authored"` on `main` returns the record of what the coding agent shipped, up to the hackathon polish window.

## Screen recording

A screen recording of the same session (`Screen Recording 2026-09-30 at 2.56.09 AM.mov`) exists locally but is 560 MB, so it is not committed. Ask for a link or a compressed version if a moving demo is needed.
