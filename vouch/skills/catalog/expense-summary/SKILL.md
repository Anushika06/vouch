---
name: expense-summary
description: Summarise spending by category from a list of transactions.
version: 1.0.0
entrypoint: run.py
permissions:
  network: []
  files: [transactions.csv]
  tools: []
---
# expense-summary

Reads `{"transactions": [{"category": "...", "amount": 123}]}` from stdin, or the bundled
`transactions.csv` sample, and prints totals per category.
