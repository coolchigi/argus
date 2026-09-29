#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["boto3", "botocore[crt]"]
# ///
"""Correct one classification field on a PolicyRules row, per the ADR-0001
amendment of 2026-09-29.

A PolicyRules row is content-addressed: rule_hash is SHA256 of rule_content.
The content and its source fields never change. The classification fields
Sentinel's model put on the row can be corrected, and each correction is
appended to the row's classification_corrections list with the old value,
so replay can still tell what the row said at any earlier time.

Dry run is the default and makes read calls only (GetItem, Query, Scan).
Nothing is written unless you pass --apply.

Example (the spousal open work permit page filed as pgwp):

  uv run scripts/correct_rule_classification.py \\
    --rule-hash 23f601dd0d88b7edf7a7fa7ac7e6af70fa73446e0983e80cfa4b7da390a8ac78 \\
    --field policy_domain --from pgwp --to sowp \\
    --corrected-by chi \\
    --reason "Classified before the domain definitions landed (dc28dd2). The page covers spouses and dependent children."
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

# The taxonomy Sentinel classifies into. Source of truth:
# services/sentinel/src/classify.ts. Keep these in step with it.
CORRECTABLE_FIELDS: dict[str, tuple[str, ...]] = {
    "policy_domain": ("express-entry", "pgwp", "sowp", "pgp", "pnp", "study-permit", "general", "other"),
    "category": ("ministerial-instruction", "news-release", "rounds-of-invitations", "policy-page-change"),
    "severity": ("low", "medium", "high"),
    "rule_kind": ("scoring", "interpretation", "procedural"),
}

# rule_content is never printed. Only these fields are shown from the row.
ROW_DISPLAY_FIELDS = (
    "rule_hash", "policy_domain", "topic", "category", "severity", "rule_kind",
    "source_url", "source_s3_key", "source_s3_version_id", "captured_at", "deprecated_at",
)

DEFAULT_REGION = "us-east-1"
DEFAULT_TABLES = {
    "policy_rules": "argus-policy-rules",
    "rule_index": "argus-rule-index",
    "impact_assessments": "argus-impact-assessments",
    "training_corrections": "argus-training-corrections",
}


class Refusal(Exception):
    """The correction can't be applied as asked. Nothing was written."""


def content_hash(rule_content: str) -> str:
    return hashlib.sha256(rule_content.encode("utf-8")).hexdigest()


def plan_correction(
    row: dict[str, Any] | None,
    *,
    rule_hash: str,
    field: str,
    from_value: str,
    to_value: str,
    corrected_by: str,
    reason: str,
    now: datetime,
    correction_id: str,
) -> dict[str, Any]:
    """Checks the row and builds the UpdateItem request. Raises Refusal on
    anything that would make the correction wrong or unsafe."""
    if field not in CORRECTABLE_FIELDS:
        raise Refusal(f"{field} is not a correctable classification field. Allowed: {', '.join(CORRECTABLE_FIELDS)}")
    allowed = CORRECTABLE_FIELDS[field]
    if to_value not in allowed:
        raise Refusal(f"--to {to_value!r} is not a known {field}. Allowed: {', '.join(allowed)}")
    if from_value == to_value:
        raise Refusal("--from and --to are the same value")
    if not corrected_by.strip():
        raise Refusal("--corrected-by is required")
    if not reason.strip():
        raise Refusal("--reason is required")
    if row is None:
        raise Refusal(f"no PolicyRules row with rule_hash {rule_hash}")

    content = row.get("rule_content")
    if not isinstance(content, str) or content_hash(content) != rule_hash:
        # Test fixtures and hand-written rows don't hash to their key. A
        # classification correction is only defined for a real
        # content-addressed rule.
        raise Refusal("rule_content does not hash to rule_hash, so this row is not a content-addressed rule")

    current = row.get(field)
    if current == to_value:
        raise Refusal(f"{field} is already {to_value!r}. Nothing to do.")
    if current != from_value:
        raise Refusal(f"{field} is {current!r}, expected --from {from_value!r}. Re-check before correcting.")

    entry = {
        "correction_id": correction_id,
        "field": field,
        "from": from_value,
        "to": to_value,
        "corrected_at": now.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "corrected_by": corrected_by.strip(),
        "reason": reason.strip(),
    }
    return {
        "Key": {"rule_hash": rule_hash},
        "UpdateExpression": "SET #f = :to, #cc = list_append(if_not_exists(#cc, :empty), :entry)",
        # The row must still exist, still hold the value we checked, and the
        # content must be the content we hashed. Sentinel never updates a
        # PolicyRules row, so a changed value means someone else corrected it.
        "ConditionExpression": "attribute_exists(rule_hash) AND #f = :from AND captured_at = :captured_at",
        "ExpressionAttributeNames": {"#f": field, "#cc": "classification_corrections"},
        "ExpressionAttributeValues": {
            ":to": to_value,
            ":from": from_value,
            ":captured_at": row.get("captured_at"),
            ":empty": [],
            ":entry": [entry],
        },
    }


def row_summary(row: dict[str, Any]) -> dict[str, Any]:
    out = {k: row.get(k) for k in ROW_DISPLAY_FIELDS if k in row}
    out["classification_corrections"] = row.get("classification_corrections") or []
    return out


# ---------------------------------------------------------------- AWS side


def scan_all(table, **kwargs) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    while True:
        res = table.scan(**kwargs)
        items.extend(res.get("Items", []))
        if "LastEvaluatedKey" not in res:
            return items
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def impact_report(ddb, tables: dict[str, str], rule_hash: str, topic: str | None) -> dict[str, Any]:
    """Read-only. What else cites this rule, so the operator sees the blast
    radius before applying."""
    from boto3.dynamodb.conditions import Attr, Key

    report: dict[str, Any] = {}
    if topic:
        res = ddb.Table(tables["rule_index"]).query(KeyConditionExpression=Key("topic").eq(topic))
        report["rule_index"] = [
            {"topic": i.get("topic"), "effective_from": i.get("effective_from"), "rule_hash": i.get("rule_hash")}
            for i in res.get("Items", [])
        ]
    # Opaque keys and outcome only. No narrative, no client profile data.
    assessments = scan_all(
        ddb.Table(tables["impact_assessments"]),
        FilterExpression=Attr("ruleHash").eq(rule_hash),
        ProjectionExpression="rcicId, assessmentKey, policyEventId, isAffected, #ts",
        ExpressionAttributeNames={"#ts": "timestamp"},
    )
    report["impact_assessments"] = sorted(
        ({k: (bool(v) if k == "isAffected" else v) for k, v in a.items()} for a in assessments),
        key=lambda a: a.get("timestamp", ""),
    )
    corrections = scan_all(
        ddb.Table(tables["training_corrections"]),
        FilterExpression=Attr("ruleHash").eq(rule_hash),
        ProjectionExpression="rcicId, correctionKey, topic, policyDomain, correctedAt",
    )
    report["training_corrections"] = corrections
    return report


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rule-hash", required=True)
    p.add_argument("--field", required=True, choices=sorted(CORRECTABLE_FIELDS))
    p.add_argument("--from", dest="from_value", required=True, help="the value the row holds now")
    p.add_argument("--to", dest="to_value", required=True, help="the corrected value")
    p.add_argument("--corrected-by", required=True, help="operator id, e.g. chi. Never a client identifier.")
    p.add_argument("--reason", required=True)
    p.add_argument("--apply", action="store_true", help="write the correction. Without it, nothing is written.")
    p.add_argument("--profile", default=None)
    p.add_argument("--region", default=DEFAULT_REGION)
    args = p.parse_args(argv)

    import boto3
    from botocore.exceptions import ClientError

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    ddb = session.resource("dynamodb")
    tables = dict(DEFAULT_TABLES)
    rules = ddb.Table(tables["policy_rules"])

    mode = "APPLY" if args.apply else "DRY RUN (read-only)"
    print(f"== {mode}: {args.field} {args.from_value!r} -> {args.to_value!r} on {args.rule_hash}\n")

    row = rules.get_item(Key={"rule_hash": args.rule_hash}, ConsistentRead=True).get("Item")
    if row is not None:
        print("-- PolicyRules row now (rule_content omitted)")
        print(json.dumps(row_summary(row), indent=2, default=str))
        print(f"   rule_content hashes to rule_hash: {isinstance(row.get('rule_content'), str) and content_hash(row['rule_content']) == args.rule_hash}\n")

    try:
        request = plan_correction(
            row,
            rule_hash=args.rule_hash,
            field=args.field,
            from_value=args.from_value,
            to_value=args.to_value,
            corrected_by=args.corrected_by,
            reason=args.reason,
            now=datetime.now(timezone.utc),
            correction_id=str(uuid.uuid4()),
        )
    except Refusal as r:
        print(f"REFUSED: {r}")
        return 2

    print("-- What else cites this rule (read-only)")
    print(json.dumps(impact_report(ddb, tables, args.rule_hash, row.get("topic") if row else None), indent=2, default=str))
    print()
    print("-- UpdateItem request")
    print(json.dumps({"TableName": tables["policy_rules"], **request}, indent=2, default=str))
    print()

    if not args.apply:
        print("Dry run. Nothing written. Re-run with --apply to write the correction.")
        return 0

    try:
        rules.update_item(**request)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            print("REFUSED by DynamoDB: the row changed since it was read. Nothing written. Re-run the dry run.")
            return 3
        raise

    after = rules.get_item(Key={"rule_hash": args.rule_hash}, ConsistentRead=True).get("Item")
    print("-- PolicyRules row after (rule_content omitted)")
    print(json.dumps(row_summary(after or {}), indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
