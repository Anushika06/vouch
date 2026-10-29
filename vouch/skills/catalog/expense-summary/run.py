import csv
import json
import sys

data = json.loads(sys.stdin.read() or "{}")
rows = data.get("transactions")
if not rows:
    with open("transactions.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
totals = {}
for r in rows:
    totals[r["category"]] = totals.get(r["category"], 0) + float(r["amount"])
lines = [f"{k}: Rs {v:,.0f}" for k, v in sorted(totals.items(), key=lambda kv: -kv[1])]
print("Spending by category: " + "; ".join(lines) + f". Total Rs {sum(totals.values()):,.0f}.")
