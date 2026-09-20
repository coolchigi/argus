#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["boto3", "botocore[crt]"]
# ///
"""Look up authoritative AWS pricing for services in the Argus stack.

Queries the AWS Price List API in us-east-1 with the aws-agent profile.
Reports real per-unit prices. No math in prose, no memory-based numbers.
"""
import json
import re
import sys
import boto3
from botocore.exceptions import ClientError

session = boto3.Session(profile_name="aws-agent", region_name="us-east-1")
pricing = session.client("pricing")

def show(title):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def price_from_product(product_json):
    """Extract (unit, USD_price, description) from a Price List product."""
    p = json.loads(product_json) if isinstance(product_json, str) else product_json
    terms = p.get("terms", {}).get("OnDemand", {})
    for _, term in terms.items():
        for _, dim in term.get("priceDimensions", {}).items():
            usd = dim.get("pricePerUnit", {}).get("USD")
            unit = dim.get("unit")
            desc = dim.get("description", "")
            return unit, usd, desc
    return None, None, None


def scan_service(service_code, want_locations=("US East (N. Virginia)",), keyword=None, limit=500):
    """Iterate all products for a service, filter by keyword in description or usagetype."""
    matches = []
    paginator = pricing.get_paginator("get_products")
    try:
        pages = paginator.paginate(
            ServiceCode=service_code,
            Filters=[{"Type": "TERM_MATCH", "Field": "regionCode", "Value": "us-east-1"}],
            PaginationConfig={"MaxItems": limit, "PageSize": 100},
        )
    except ClientError as e:
        print(f"ERROR scanning {service_code}: {e.response['Error']['Message']}")
        return []
    for page in pages:
        for pl in page.get("PriceList", []):
            p = json.loads(pl)
            attrs = p.get("product", {}).get("attributes", {})
            loc = attrs.get("location", "")
            if want_locations and loc and loc not in want_locations:
                continue
            hay = " ".join([attrs.get("usagetype", ""), attrs.get("operation", ""), attrs.get("description", ""), attrs.get("groupDescription", "")])
            if keyword and keyword.lower() not in hay.lower():
                continue
            unit, usd, desc = price_from_product(p)
            matches.append({
                "usagetype": attrs.get("usagetype", ""),
                "group": attrs.get("groupDescription", "") or attrs.get("group", ""),
                "operation": attrs.get("operation", ""),
                "description": desc,
                "unit": unit,
                "usd": usd,
            })
    return matches


def print_rows(rows, kind_re=None, cap=40):
    """Print rows in a compact table, optional filter."""
    printed = 0
    for r in rows:
        line = f"{r['usagetype'] or '-':50s}  ${r['usd'] or '?':>10s}/{r['unit'] or '-':<12s}  {r['description'][:70]}"
        if kind_re and not re.search(kind_re, r["usagetype"] + " " + r["description"], re.I):
            continue
        print(line)
        printed += 1
        if printed >= cap:
            print(f"... ({len(rows) - printed} more rows suppressed)")
            break
    if printed == 0:
        print("(no rows matched)")


# 0. Discover: which AWS services have "AgentCore" in the code
show("Service codes: search for 'agentcore' and 'bedrock' and 'cognito'")
try:
    codes = pricing.describe_services()["Services"]
    for c in codes:
        code = c["ServiceCode"]
        if re.search(r"(agentcore|bedrock|cognito)", code, re.I):
            print(f"  {code}")
except ClientError as e:
    print(f"ERROR: {e.response['Error']['Message']}")


# 1. Bedrock: Nova Micro / Nova Lite / Nova Pro / Claude Haiku 4.5 tokens
show("Bedrock model-invocation pricing (input, output, cache tokens)")
rows = scan_service("AmazonBedrock", keyword="Nova")
print("\n--- Nova family ---")
print_rows(rows, kind_re=r"(Nova.?Micro|Nova.?Lite|Nova.?Pro)", cap=80)

rows = scan_service("AmazonBedrock", keyword="Haiku")
print("\n--- Claude Haiku (4.5 target) ---")
print_rows(rows, kind_re=r"Haiku.*4", cap=80)

rows = scan_service("AmazonBedrock", keyword="cache")
print("\n--- Cache-token pricing (write/read) ---")
print_rows(rows, kind_re=r"cache", cap=80)


# 2. AgentCore Runtime + Gateway (may be under a distinct service code)
show("AgentCore Runtime and Gateway")
for code_guess in ("AmazonBedrockAgentCore", "BedrockAgentCore", "AmazonBedrockAgent", "AmazonBedrock"):
    print(f"\n--- Trying service code: {code_guess} ---")
    rows = scan_service(code_guess, keyword="agentcore")
    if rows:
        print_rows(rows, cap=40)
    else:
        print(f"  (no rows via {code_guess} + 'agentcore' keyword)")


# 3. Cognito
show("Cognito user-pool MAU pricing")
rows = scan_service("AmazonCognito", keyword=None)
if not rows:
    for alt in ("AWSCognito", "AmazonCognitoIdentity"):
        rows = scan_service(alt, keyword=None)
        if rows:
            print(f"(via service code {alt})")
            break
print_rows(rows, kind_re=r"(MAU|monthly.?active|user.pool|essentials|plus)", cap=40)


# 4. KMS
show("KMS: customer-managed keys and API request pricing")
rows = scan_service("awskms", keyword=None)
if not rows:
    rows = scan_service("AWSKMS", keyword=None)
print_rows(rows, kind_re=r"(key.month|requests?|api)", cap=40)


# 5. CloudWatch Logs
show("CloudWatch Logs: ingestion, storage, encryption")
rows = scan_service("AmazonCloudWatch", keyword="Logs")
print_rows(rows, kind_re=r"(logs|ingest|storage|archive)", cap=40)


# 6. VPC extras: NAT Gateway, PrivateLink (interface endpoint), data transfer
show("VPC-mode extras: NAT Gateway and PrivateLink endpoint")
rows = scan_service("AmazonVPC", keyword="NAT")
print("\n--- NAT Gateway ---")
print_rows(rows, kind_re=r"NAT", cap=20)

rows = scan_service("AmazonVPC", keyword="Endpoint")
print("\n--- VPC Interface Endpoints (PrivateLink) ---")
print_rows(rows, kind_re=r"(endpoint|VpcEndpoint)", cap=20)


# 7. Amplify Hosting (frontend)
show("Amplify Hosting")
rows = scan_service("AWSAmplify", keyword=None)
if not rows:
    rows = scan_service("AmazonAmplify", keyword=None)
print_rows(rows, cap=20)


# 8. DynamoDB on-demand
show("DynamoDB on-demand (PAY_PER_REQUEST)")
rows = scan_service("AmazonDynamoDB", keyword="PayPerRequest")
if not rows:
    rows = scan_service("AmazonDynamoDB", keyword=None)
print_rows(rows, kind_re=r"(PayPerRequest|write.request|read.request|storage)", cap=20)


print("\nDONE. All prices from the AWS Price List API (us-east-1), pulled at run time.")
