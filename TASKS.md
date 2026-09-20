# TASKS

Living task list. Ephemeral Claude Code tasks live in-session. This file is what survives session compaction.

## Phase 0 (research and design): COMPLETE

- [x] Research: winner pattern deep-dives (VERA, LikenessGuard, AgriNexus, Caligo Dynamics, cross-winners scan of 11 more).
- [x] Research: 15 Ottawa RCIC targets from CICC public register, prioritised by firm size.
- [x] End-to-end design doc through 20 sections. See `docs/argus-design.md`.
- [x] Model selection via `amazon-bedrock` skill's `model-selection-guide.md`.
- [x] Real pricing pulled from AWS Price List API for Nova family, Cognito, KMS, CloudWatch Logs, VPC extras, Amplify, DynamoDB.
- [x] Repo scaffolded at `~/Documents/argus/`.

## Phase 1 (Sep 20-21): Groundwork

- [ ] Follow-up pricing queries: Nova Micro input tokens, Claude Haiku 4.5 SKU availability in us-east-1, NAT Gateway rate under `AmazonEC2` service code, CloudWatch Logs standard ingestion rate. Update `docs/argus-design.md` cost table with real numbers.
- [ ] Write `scripts/cost_model.py` with argparse levers for scenarios (10-client demo, 100-client working RCIC, 500-client firm).
- [ ] Confirm domain approach: `tryargus.ca` registered via Cloudflare, CNAME to be wired in Phase 6.
- [ ] `cdk init app --language typescript` in `infra/`.
- [ ] CDK stack skeleton: Cognito user pool (custom UI), DynamoDB tables (RcicUsers, ClientProfiles, PolicyEvents, ImpactAssessments, Alerts, AuditTrail, TrainingCorrection), S3 buckets (policy-corpus, generated-artifacts), KMS customer-managed key (ECDSA P-256).
- [ ] API Gateway HTTP API scaffolding. Empty Lambda placeholders for every route in design doc Section 10.
- [ ] Cognito authorizer wired to API Gateway.
- [ ] First green `cdk deploy` to `argus-dev` stack.
- [ ] Push to `github.com/coolchigi/argus` (private during dev, flip public before submission).
- [ ] Cost Budget: CA$50 warning, CA$150 hard alarm, scoped by tag `Project=Argus`.
- [ ] Send outreach message to Chi's warm-lead RCIC (from the earlier Maple work).
- [ ] Send batch outreach to 5 of the 15 Ottawa RCICs in `research/ottawa-rcic-targets.md`.

## Escalations still pending project lead

1. Chi's founder origin story for the "My Vision" section of the writeup. What specific dated IRCC-policy moment lit the wick?
2. Which RCIC from the Ottawa list is Chi's warm lead? Or is it not in the list?
3. GitHub repo visibility on push: private then flip, or public from the start?

## Phase 2 onward

See `plan.md`. Detailed task lists get filled in at the start of each phase.
