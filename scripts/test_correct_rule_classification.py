"""Offline tests for correct_rule_classification.py. No AWS calls.

Run: python3 -m unittest scripts/test_correct_rule_classification.py
"""
import hashlib
import re
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import correct_rule_classification as crc  # noqa: E402

CONTENT = "# Open work permits for spouses\n\n- rule text"
HASH = hashlib.sha256(CONTENT.encode("utf-8")).hexdigest()
NOW = datetime(2026, 9, 29, 18, 0, 0, tzinfo=timezone.utc)


def row(**overrides):
    base = {
        "rule_hash": HASH,
        "rule_content": CONTENT,
        "policy_domain": "pgwp",
        "topic": "open-work-permit-eligibility",
        "severity": "medium",
        "captured_at": "2026-09-28T15:44:37.807Z",
    }
    base.update(overrides)
    return base


def plan(r, **overrides):
    args = dict(
        rule_hash=HASH,
        field="policy_domain",
        from_value="pgwp",
        to_value="sowp",
        corrected_by="chi",
        reason="classified before the domain definitions landed",
        now=NOW,
        correction_id="c-1",
    )
    args.update(overrides)
    return crc.plan_correction(r, **args)


class PlanCorrection(unittest.TestCase):
    def test_sets_the_new_value_and_appends_the_old_one(self):
        req = plan(row())
        self.assertEqual(req["Key"], {"rule_hash": HASH})
        self.assertIn("SET #f = :to", req["UpdateExpression"])
        self.assertIn("list_append(if_not_exists(#cc, :empty), :entry)", req["UpdateExpression"])
        self.assertEqual(req["ExpressionAttributeNames"], {"#f": "policy_domain", "#cc": "classification_corrections"})
        values = req["ExpressionAttributeValues"]
        self.assertEqual(values[":to"], "sowp")
        self.assertEqual(
            values[":entry"],
            [{
                "correction_id": "c-1",
                "field": "policy_domain",
                "from": "pgwp",
                "to": "sowp",
                "corrected_at": "2026-09-29T18:00:00.000Z",
                "corrected_by": "chi",
                "reason": "classified before the domain definitions landed",
            }],
        )

    def test_write_is_conditional_on_the_value_that_was_checked(self):
        req = plan(row())
        self.assertIn("#f = :from", req["ConditionExpression"])
        self.assertIn("attribute_exists(rule_hash)", req["ConditionExpression"])
        self.assertEqual(req["ExpressionAttributeValues"][":from"], "pgwp")
        self.assertEqual(req["ExpressionAttributeValues"][":captured_at"], "2026-09-28T15:44:37.807Z")

    def test_never_touches_content_or_identity_fields(self):
        req = plan(row())
        for protected in ("rule_content", "rule_hash", "topic", "source_url", "source_s3_key", "source_s3_version_id", "captured_at"):
            self.assertNotIn(protected, req["ExpressionAttributeNames"].values())
            self.assertNotIn(f"SET {protected}", req["UpdateExpression"])

    def test_refuses_a_row_whose_content_does_not_hash_to_its_key(self):
        with self.assertRaisesRegex(crc.Refusal, "does not hash"):
            plan(row(rule_content=CONTENT + " edited"))
        with self.assertRaisesRegex(crc.Refusal, "does not hash"):
            plan(row(rule_content=None))

    def test_refuses_when_the_row_holds_a_different_value(self):
        with self.assertRaisesRegex(crc.Refusal, "expected --from"):
            plan(row(policy_domain="express-entry"))

    def test_refuses_a_second_run_once_corrected(self):
        with self.assertRaisesRegex(crc.Refusal, "already"):
            plan(row(policy_domain="sowp"))

    def test_refuses_a_value_outside_the_taxonomy(self):
        with self.assertRaisesRegex(crc.Refusal, "not a known policy_domain"):
            plan(row(), to_value="spousal-open-work-permit")

    def test_refuses_topic_and_other_non_correctable_fields(self):
        for field in ("topic", "rule_content", "rule_hash", "summary", "source_url"):
            with self.assertRaisesRegex(crc.Refusal, "not a correctable"):
                plan(row(), field=field)

    def test_refuses_a_missing_row_and_blank_audit_fields(self):
        with self.assertRaisesRegex(crc.Refusal, "no PolicyRules row"):
            plan(None)
        with self.assertRaisesRegex(crc.Refusal, "reason"):
            plan(row(), reason="  ")
        with self.assertRaisesRegex(crc.Refusal, "corrected-by"):
            plan(row(), corrected_by="")


class TaxonomyInStepWithSentinel(unittest.TestCase):
    """The script's allowed values must match what Sentinel classifies into."""

    def test_enums_match_classify_ts(self):
        src = (HERE.parent / "services/sentinel/src/classify.ts").read_text()
        names = {"policy_domain": "POLICY_DOMAINS", "category": "CATEGORIES", "severity": "SEVERITIES", "rule_kind": "RULE_KINDS"}
        for field, const in names.items():
            m = re.search(rf"export const {const} = \[([^\]]*)\] as const;", src)
            self.assertIsNotNone(m, f"{const} not found in classify.ts")
            ts_values = tuple(re.findall(r"'([^']+)'", m.group(1)))
            self.assertEqual(crc.CORRECTABLE_FIELDS[field], ts_values, field)


if __name__ == "__main__":
    unittest.main()
