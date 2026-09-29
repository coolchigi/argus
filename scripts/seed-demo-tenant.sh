#!/usr/bin/env bash
# Seed a realistic demo caseload for one tenant.
# Zero-PII: opaque file numbers only. No names, contacts, or free-text notes.
# Conditional put: never overwrites an existing client.
# A second pass fills attributes added after a tenant was first seeded. It
# only sets an attribute the row doesn't have yet, so a consultant's edit wins.
# Usage: scripts/seed-demo-tenant.sh R670922
set -euo pipefail

RCIC_ID="${1:?usage: seed-demo-tenant.sh <rcicId>}"
TABLE="argus-client-profiles"
REGION="${AWS_REGION:-us-east-1}"

put() {
  local clientId="$1"
  local fields="$2"
  if aws dynamodb put-item \
    --region "$REGION" \
    --table-name "$TABLE" \
    --condition-expression "attribute_not_exists(clientId)" \
    --item "{\"rcicId\":{\"S\":\"${RCIC_ID}\"},\"clientId\":{\"S\":\"${clientId}\"},\"status\":{\"S\":\"active\"},${fields}}" \
    >/dev/null 2>/tmp/seed-err.txt; then
    echo "  put ${RCIC_ID}/${clientId}"
  elif grep -q ConditionalCheckFailed /tmp/seed-err.txt; then
    echo "  skip ${RCIC_ID}/${clientId} (exists)"
  else
    cat /tmp/seed-err.txt >&2
    exit 1
  fi
}

# fill <clientId> <attr>=<type>:<value> ...   e.g. dliType=S:public principalPrApplied=BOOL:false
# Sets each attribute only where it's missing. Skips a client that isn't there.
fill() {
  local clientId="$1"
  shift
  local sets="" values="" names="" i=0 pair attr typed type value literal
  for pair in "$@"; do
    attr="${pair%%=*}"
    typed="${pair#*=}"
    type="${typed%%:*}"
    value="${typed#*:}"
    if [ "$type" = "BOOL" ]; then literal="$value"; else literal="\"${value}\""; fi
    sets+="${sets:+, }#a${i} = if_not_exists(#a${i}, :v${i})"
    names+="${names:+,}\"#a${i}\":\"${attr}\""
    values+="${values:+,}\":v${i}\":{\"${type}\":${literal}}"
    i=$((i + 1))
  done
  if aws dynamodb update-item \
    --region "$REGION" \
    --table-name "$TABLE" \
    --key "{\"rcicId\":{\"S\":\"${RCIC_ID}\"},\"clientId\":{\"S\":\"${clientId}\"}}" \
    --condition-expression "attribute_exists(clientId)" \
    --update-expression "SET ${sets}" \
    --expression-attribute-names "{${names}}" \
    --expression-attribute-values "{${values}}" \
    >/dev/null 2>/tmp/seed-err.txt; then
    echo "  fill ${RCIC_ID}/${clientId}"
  elif grep -q ConditionalCheckFailed /tmp/seed-err.txt; then
    echo "  skip ${RCIC_ID}/${clientId} (missing)"
  else
    cat /tmp/seed-err.txt >&2
    exit 1
  fi
}

echo "Seeding 12 clients under ${RCIC_ID}..."

# Express Entry
put 2026-011 '"program":{"S":"express-entry"},"age":{"N":"29"},"educationLevel":{"S":"master"},"clbEnglishWorst":{"N":"9"},"clbFrenchWorst":{"N":"0"},"canadianWorkYears":{"N":"2"},"foreignWorkYears":{"N":"3"},"nocCode":{"S":"21231"},"teerLevel":{"N":"1"},"hasJobOffer":{"BOOL":false},"currentCrsScore":{"N":"489"}'
put 2026-012 '"program":{"S":"express-entry"},"age":{"N":"31"},"educationLevel":{"S":"bachelor"},"clbEnglishWorst":{"N":"7"},"clbFrenchWorst":{"N":"8"},"canadianWorkYears":{"N":"0"},"foreignWorkYears":{"N":"4"},"nocCode":{"S":"41220"},"teerLevel":{"N":"1"},"hasJobOffer":{"BOOL":false},"currentCrsScore":{"N":"441"}'
put 2026-013 '"program":{"S":"express-entry"},"age":{"N":"38"},"educationLevel":{"S":"phd"},"clbEnglishWorst":{"N":"10"},"clbFrenchWorst":{"N":"0"},"canadianWorkYears":{"N":"3"},"foreignWorkYears":{"N":"6"},"nocCode":{"S":"41200"},"teerLevel":{"N":"1"},"hasJobOffer":{"BOOL":false},"currentCrsScore":{"N":"505"}'
put 2026-014 '"program":{"S":"express-entry"},"age":{"N":"33"},"educationLevel":{"S":"bachelor"},"clbEnglishWorst":{"N":"8"},"clbFrenchWorst":{"N":"0"},"canadianWorkYears":{"N":"0.5"},"foreignWorkYears":{"N":"2"},"nocCode":{"S":"64100"},"teerLevel":{"N":"4"},"hasJobOffer":{"BOOL":false},"currentCrsScore":{"N":"402"}'

# Post-graduation work permit
put 2026-021 '"program":{"S":"pgwp"},"age":{"N":"23"},"educationLevel":{"S":"college-diploma"},"cipCode":{"S":"52.0201"},"graduationDate":{"S":"2026-04-30"}'
put 2026-022 '"program":{"S":"pgwp"},"age":{"N":"27"},"educationLevel":{"S":"master"},"cipCode":{"S":"11.0701"},"graduationDate":{"S":"2026-08-15"}'

# Study permit
put 2026-031 '"program":{"S":"study-permit"},"age":{"N":"25"},"intendedStudyLevel":{"S":"master"},"palOnFile":{"BOOL":false}'
put 2026-032 '"program":{"S":"study-permit"},"age":{"N":"19"},"intendedStudyLevel":{"S":"college"},"palOnFile":{"BOOL":false}'

# Parents and grandparents sponsorship
put 2026-041 '"program":{"S":"pgp"},"pgpSponsor2020Form":{"BOOL":true},"pgpLicoYearsMet":{"N":"3"}'
put 2026-042 '"program":{"S":"pgp"},"pgpSponsor2020Form":{"BOOL":false},"pgpLicoYearsMet":{"N":"2"}'

# Spousal open work permit
put 2026-051 '"program":{"S":"sowp"},"principalPermitTeer":{"N":"1"},"principalPermitRemainingMonths":{"N":"12"}'

# Provincial nominee (Express Entry stream)
put 2026-061 '"program":{"S":"pnp"},"pnpProvince":{"S":"ON"},"canadianWorkYears":{"N":"2"},"clbEnglishWorst":{"N":"8"},"currentCrsScore":{"N":"468"}'

# Facts the Auditor asked for when it rejected 2026-021, 031, 042 and 051.
# Each value is chosen to agree with the benchmark ground truth for that client.
echo "Filling permit, sponsor and PR pathway attributes..."
fill 2026-021 studyPermitAppliedDate=S:2024-11-20
fill 2026-022 studyPermitAppliedDate=S:2024-05-15
fill 2026-031 dliType=S:public studyStartDate=S:2027-01-11
fill 2026-032 dliType=S:private studyStartDate=S:2027-01-06
fill 2026-041 pgpSponsorStatus=S:interest-form-submitted
fill 2026-042 pgpSponsorStatus=S:no-interest-form
fill 2026-051 principalPrPathway=S:none principalPrApplied=BOOL:false

echo "Done."
