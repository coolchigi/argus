# Argus

100 eyes on IRCC. Zero of them yours.

Argus is a multi-agent policy-impact platform for licensed Canadian immigration consultants. It watches IRCC policy sources continuously, cross-references every material change against a consultant's caseload, and produces per-client impact briefs with KMS-signed audit trails.

Built for the AWS Zero to Shipped hackathon. Deadline Oct 2 2026.

## Architecture at a glance

Six named agents on Amazon Bedrock, orchestrated through Strands Agents SDK in the Graph pattern. Each is a separate Bedrock invocation with its own model, prompt, and tool set.

- **Sentinel** watches IRCC pages hourly and emits structured PolicyDeltas.
- **Analyst** turns each PolicyDelta into per-client impact hypotheses.
- **Auditor** (with a parallel Auditor 2 on high-stakes claims) rejects Analyst outputs that fail schema, citations, or edge-case tests. Cross-family adversarial.
- **Anchor** attaches exact IRCC paragraph text plus URL plus revision hash, then KMS-signs the assessment.
- **Composer** drafts per-client briefs and calls HeyGen for narrated videos on high-impact deltas.
- **Recall** nightly re-scans the last 30 days of IRCC pages for anything Sentinel missed.

Orchestrator runs in a Lambda invoked by Step Functions Express Workflows. MCP surface for consultants' Claude Code is provided by AgentCore Gateway wrapping our REST API.

## Repo structure

- `docs/argus-design.md`. End-to-end design doc. Source of truth.
- `docs/adr/`. Architecture Decision Records (added in Phase 1).
- `plan.md`. 7-phase sprint plan.
- `TASKS.md`. Current-phase task list.
- `research/`. Winner-pattern intel, Ottawa RCIC target list, B2B competitive research.
- `infra/`. AWS CDK v2 stack (TypeScript).
- `services/`. One folder per agent, plus the orchestrator.
- `web/`. Next.js dashboard.
- `scripts/`. Utilities. `pricing_lookup.py` queries the AWS Price List API. `cost_model.py` (pending) runs cost scenarios.

## How to run

Phase 1 not yet built. See `plan.md`.

## Attribution

Built with Claude Code and the AWS Agent Toolkit. Project-scoped instructions the coding agent operates under are in `CLAUDE.md`.
