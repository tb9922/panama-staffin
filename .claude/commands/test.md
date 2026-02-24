---
allowed-tools: Bash(node:*)
description: Run all test suites and report results
---

## Your task

Run the project test scripts and report a summary. Execute these in parallel:

1. `node test_rotation.js` — rotation logic tests
2. `node test_costs.js` — cost calculation tests
3. `node test_coverage.js` — coverage and AL tests

For each script, report:
- Total tests passed / failed
- Any specific failures with details

At the end, give a one-line overall verdict: ALL PASS or X FAILURES FOUND.

If a test file doesn't exist, note it and continue with the others.
