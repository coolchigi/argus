#!/usr/bin/env python3
"""Convert the design doc's CAD budget alarms to the USD AWS Budgets uses.

Pulls the latest Bank of Canada daily USD/CAD rate (series FXUSDCAD, CAD per
1 USD) from the Valet API and prints the USD amounts, rounded down to the
cent so an alarm never fires later than its CAD amount. Paste the rate and
date into the `fx` prop in infra/bin/infra.ts. The stack does the same
conversion, so this script is the audit trail for the pinned rate.

Usage: python3 scripts/budget_fx.py [CAD amount ...]   (default: 50 200)
"""
import json
import sys
import urllib.request
from decimal import ROUND_FLOOR, Decimal

URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1"


def main() -> None:
    amounts = [Decimal(a) for a in sys.argv[1:]] or [Decimal(50), Decimal(200)]
    with urllib.request.urlopen(URL, timeout=15) as resp:
        obs = json.load(resp)["observations"][0]
    day, rate = obs["d"], Decimal(obs["FXUSDCAD"]["v"])
    print(f"source: Bank of Canada Valet FXUSDCAD, observed {day}")
    print(f"rate: {rate} CAD per USD")
    for cad in amounts:
        usd = (cad / rate).quantize(Decimal("0.01"), rounding=ROUND_FLOOR)
        print(f"CA${cad} -> US${usd}")


if __name__ == "__main__":
    main()
