# Argus plan

Full end-to-end design in [docs/argus-design.md](docs/argus-design.md). This file is the roadmap and sprint state.

## Sprint

Zero to Shipped hackathon. Sep 19 to Oct 2 2026, 11:59 PM PDT.
Judging window: Oct 5 to Oct 19 2026. Winners announced week of Oct 19.

## 7 phases

1. **Phase 1 (Sep 20-21). Groundwork.** CDK v2 skeleton in TypeScript. Cognito user pool. DynamoDB tables. S3 buckets. KMS key. Empty API Gateway HTTP API with Lambda placeholders. First green `cdk deploy` to `argus-dev`. Cost budget alarms.
2. **Phase 2 (Sep 22-23). Sentinel and policy corpus.** Sentinel Lambda diffs IRCC pages hourly. S3 policy corpus populated. Bedrock Knowledge Base ingesting policy paragraphs on S3 Vectors backend.
3. **Phase 3 (Sep 24-25). Analyst and caseload.** Analyst runs on chosen model via Strands. Seeded 10-client caseload. First per-client impact narratives against the March 25 2025 CRS scorecard change. Prompt caching validated with `cacheReadInputTokens > 0` on second call.
4. **Phase 4 (Sep 26-27). Auditor(s), Anchor, trust layer.** Auditor 1 gating. Auditor 2 parallel on high-stakes claims (CRS delta > 30 points, or eligibility flip). Anchor attaches exact IRCC paragraphs plus URL plus revision hash. KMS ECDSA P-256 signing every assessment. Public JWKS endpoint on CloudFront.
5. **Phase 5 (Sep 28-29). Composer, dashboard, Recall.** Composer drafts per-client briefs. Next.js dashboard shows the red-banner alert flow. Demo trigger endpoint end-to-end. Recall agent nightly re-scan of the last 30 days IRCC pages.
6. **Phase 6 (Sep 30 - Oct 1). Polish, video, MCP Gateway.** brag runs 20 tone variants. HeyGen narrator overlay for cold open and close. `tryargus.ca` wired via Cloudflare CNAME to Amplify hostname. AgentCore Gateway wraps our REST API as MCP tools. Public GitHub polished. First Ottawa RCIC testimonial call recorded, with permission.
7. **Phase 7 (Oct 2). Submission.** Writeup follows Caligo section-header pattern (My Vision -> Why This Matters -> Competitive Landscape -> How I Built This -> Demo -> What I Learned -> Named Validators -> Closing byline). Submitted before noon PDT.

## Current phase

Phase 0 (research plus design): LOCKED.
Phase 1 begins Sep 20.

## Attribution

Every architectural decision has an ADR in `docs/adr/` (populated starting Phase 1). Every ADR names the skill or reference that informed the decision.
