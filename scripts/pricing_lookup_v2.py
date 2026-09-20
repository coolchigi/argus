#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["boto3", "botocore[crt]"]
# ///
"""Follow-up pricing lookup for Argus.

Fills the gaps from the first pricing run: Nova Micro input tokens,
Claude Haiku 4.5 SKU availability, CloudWatch Logs standard ingest.

NAT Gateway is intentionally NOT queried. The Argus design skips VPC
mode for the hackathon window, so Lambdas run outside any VPC and have
public internet access by default. See docs/argus-design.md Section 9.
"""
import json
import re
import sys
import boto3
from botocore.exceptions import ClientError

session = boto3.Session(profile_name="aws-agent", region_name="us-east-1")
pricing = session.client("pricing")

US_EAST_1_LABEL = "US East (N. Virginia)"


def show(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def price_from_product(p: dict) -> tuple[str, str, str]:
    terms = p.get("terms", {}).get("OnDemand", {})
    for _, term in terms.items():
        for _, dim in term.get("priceDimensions", {}).items():
            return dim.get("unit", ""), dim.get("pricePerUnit", {}).get("USD", ""), dim.get("description", "")
    return "", "", ""


def scan(service_code: str, filters=None, limit=2000):
    """Paginated get_products with region filter."""
    fs = [{"Type": "TERM_MATCH", "Field": "regionCode", "Value": "us-east-1"}]
    for f in filters or []:
        fs.append(f)
    matches = []
    try:
        paginator = pricing.get_paginator("get_products")
        pages = paginator.paginate(
            ServiceCode=service_code,
            Filters=fs,
            PaginationConfig={"MaxItems": limit, "PageSize": 100},
        )
        for page in pages:
            for pl in page.get("PriceList", []):
                p = json.loads(pl)
                matches.append(p)
    except ClientError as e:
        print(f"ERROR scanning {service_code}: {e.response['Error']['Message']}")
    return matches


def print_row(usagetype: str, unit: str, usd: str, description: str) -> None:
    print(f"  {usagetype:60s}  ${usd:>13s}/{unit:<12s}  {description[:80]}")


# 1. Nova Micro: input, output, cache read, cache write. Include all Micro rows.
show("Nova Micro: all pricing rows in us-east-1")
products = scan("AmazonBedrock", filters=[{"Type": "TERM_MATCH", "Field": "model", "Value": "Amazon Nova Micro"}])
if not products:
    products = scan("AmazonBedrock")
    products = [p for p in products if "novamicro" in p.get("product", {}).get("attributes", {}).get("usagetype", "").lower()]
for p in products:
    attrs = p.get("product", {}).get("attributes", {})
    ut = attrs.get("usagetype", "")
    if "novamicro" not in ut.lower():
        continue
    unit, usd, desc = price_from_product(p)
    print_row(ut, unit, usd, desc)


# 2. Claude Haiku 4.5. Try model attribute, then any anthropic Haiku 4.5.
show("Claude Haiku 4.5: model-attribute search")
for hint in ["Claude Haiku 4.5", "Claude 3.5 Haiku", "Claude 4.5 Haiku", "Anthropic Claude Haiku"]:
    products = scan("AmazonBedrock", filters=[{"Type": "TERM_MATCH", "Field": "model", "Value": hint}])
    if products:
        print(f"\n-- Hits for model = '{hint}': {len(products)} --")
        for p in products[:12]:
            attrs = p.get("product", {}).get("attributes", {})
            ut = attrs.get("usagetype", "")
            unit, usd, desc = price_from_product(p)
            print_row(ut, unit, usd, desc)
        break

show("Claude Haiku 4.5: keyword sweep across all AmazonBedrock in us-east-1")
products = scan("AmazonBedrock")
haiku_hits = []
for p in products:
    attrs = p.get("product", {}).get("attributes", {})
    ut = attrs.get("usagetype", "")
    model = attrs.get("model", "")
    if re.search(r"(haiku[-.]?4[.-]?5|claude.?haiku.?4)", ut + " " + model, re.I):
        haiku_hits.append(p)
print(f"Haiku 4.5-shaped hits: {len(haiku_hits)}")
for p in haiku_hits[:30]:
    attrs = p.get("product", {}).get("attributes", {})
    ut = attrs.get("usagetype", "")
    unit, usd, desc = price_from_product(p)
    print_row(ut, unit, usd, desc)

# What Haiku SKUs exist at all in us-east-1?
show("All Claude Haiku SKUs in us-east-1 (any version)")
for p in products:
    attrs = p.get("product", {}).get("attributes", {})
    ut = attrs.get("usagetype", "")
    if "haiku" in ut.lower():
        unit, usd, desc = price_from_product(p)
        print_row(ut, unit, usd, desc)


# 3. CloudWatch Logs standard ingest.
show("CloudWatch Logs: standard ingest (not vended)")
products = scan("AmazonCloudWatch")
for p in products:
    attrs = p.get("product", {}).get("attributes", {})
    ut = attrs.get("usagetype", "")
    desc = " ".join([attrs.get("description", ""), attrs.get("groupDescription", "")])
    if re.search(r"(DataProcessing|Ingest|IngestedBytes|Logs)", ut, re.I) and "Vended" not in ut:
        if "Log" in desc or "log" in ut.lower():
            unit, usd, dsc = price_from_product(p)
            print_row(ut, unit, usd, dsc)


# 4. KMS: verify customer-managed monthly key charge SKU (was not surfaced in v1).
show("KMS customer-managed key monthly charge")
products = scan("awskms")
for p in products:
    attrs = p.get("product", {}).get("attributes", {})
    ut = attrs.get("usagetype", "")
    desc = attrs.get("description", "")
    if re.search(r"(Keys|Key-Mo)", ut, re.I):
        unit, usd, dsc = price_from_product(p)
        print_row(ut, unit, usd, dsc)


print("\nDONE.")
