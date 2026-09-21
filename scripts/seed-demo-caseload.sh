#!/usr/bin/env bash
# Seed 5 demo client profiles under demo-rcic-001 for Phase 3 validation.
# Zero-PII: opaque client_id only, no names, no contacts.
set -euo pipefail

: "${AWS_PROFILE:=aws-agent}"
TABLE="argus-client-profiles"

put() {
  local rcicId="$1"
  local clientId="$2"
  local body="$3"
  aws dynamodb put-item \
    --table-name "$TABLE" \
    --profile "$AWS_PROFILE" \
    --item "$body" >/dev/null
  echo "  put ${rcicId}/${clientId}"
}

echo "Seeding 5 demo clients under demo-rcic-001..."

put demo-rcic-001 C-101 '{
  "rcicId":{"S":"demo-rcic-001"},"clientId":{"S":"C-101"},
  "program":{"S":"express-entry"},"status":{"S":"active"},
  "age":{"N":"30"},"educationLevel":{"S":"master"},
  "clbEnglishWorst":{"N":"9"},"clbFrenchWorst":{"N":"0"},
  "canadianWorkYears":{"N":"2"},"foreignWorkYears":{"N":"4"},
  "nocCode":{"S":"21231"},"teerLevel":{"N":"1"},
  "hasJobOffer":{"BOOL":true},"jobOfferTeer":{"N":"1"},
  "currentCrsScore":{"N":"476"},
  "notes":{"S":"software developer, LMIA-based offer"}
}'

put demo-rcic-001 C-102 '{
  "rcicId":{"S":"demo-rcic-001"},"clientId":{"S":"C-102"},
  "program":{"S":"express-entry"},"status":{"S":"active"},
  "age":{"N":"28"},"educationLevel":{"S":"bachelor"},
  "clbEnglishWorst":{"N":"7"},"clbFrenchWorst":{"N":"8"},
  "canadianWorkYears":{"N":"0"},"foreignWorkYears":{"N":"3"},
  "nocCode":{"S":"41220"},"teerLevel":{"N":"1"},
  "hasJobOffer":{"BOOL":false},
  "currentCrsScore":{"N":"438"},
  "notes":{"S":"teacher, French-bilingual, no Canadian experience"}
}'

put demo-rcic-001 C-103 '{
  "rcicId":{"S":"demo-rcic-001"},"clientId":{"S":"C-103"},
  "program":{"S":"express-entry"},"status":{"S":"active"},
  "age":{"N":"35"},"educationLevel":{"S":"phd"},
  "clbEnglishWorst":{"N":"10"},"clbFrenchWorst":{"N":"0"},
  "canadianWorkYears":{"N":"5"},"foreignWorkYears":{"N":"7"},
  "nocCode":{"S":"41200"},"teerLevel":{"N":"1"},
  "hasJobOffer":{"BOOL":true},"jobOfferTeer":{"N":"0"},
  "currentCrsScore":{"N":"512"},
  "notes":{"S":"researcher, university appointment"}
}'

put demo-rcic-001 C-201 '{
  "rcicId":{"S":"demo-rcic-001"},"clientId":{"S":"C-201"},
  "program":{"S":"pgwp"},"status":{"S":"active"},
  "age":{"N":"24"},"educationLevel":{"S":"bachelor"},
  "cipCode":{"S":"11.0701"},"graduationDate":{"S":"2026-05-15"},
  "notes":{"S":"computer science bachelor, awaiting PGWP filing window"}
}'

put demo-rcic-001 C-301 '{
  "rcicId":{"S":"demo-rcic-001"},"clientId":{"S":"C-301"},
  "program":{"S":"pgp"},"status":{"S":"active"},
  "pgpSponsor2020Form":{"BOOL":true},"pgpLicoYearsMet":{"N":"3"},
  "notes":{"S":"sponsor in 2020 pool, LICO met 3 tax years"}
}'

echo ""
echo "Done. Table now contains:"
aws dynamodb scan --table-name "$TABLE" --profile "$AWS_PROFILE" \
  --projection-expression "rcicId, clientId, #p, #s" \
  --expression-attribute-names '{"#p":"program","#s":"status"}' \
  --output table 2>&1 | tail -20
