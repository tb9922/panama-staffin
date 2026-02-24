---
allowed-tools: Bash(node:*), Bash(git diff:*), Bash(git status:*), Read, Grep, Glob
description: End-to-end verification before committing
---

## Pre-computed context

```bash
$ git diff --name-only
```

```bash
$ git status --short
```

## Your task

Verify the current changes are correct and safe to commit. Run these checks:

### 1. Tests
Run all test scripts in parallel:
- `node test_rotation.js`
- `node test_costs.js`
- `node test_coverage.js`

Report pass/fail for each.

### 2. Change review
Review the git diff for the changed files (listed above). Check for:
- Syntax errors or typos
- Broken imports (referencing files/functions that don't exist)
- Hardcoded values that should use config
- Ad-hoc Tailwind classes that should use design.js tokens
- Date handling not using formatDate/parseDate/addDays
- Missing deep-clone before mutating overrides/data
- Console.log statements left in

### 3. Data shape consistency
If the changes modify the JSON data shape (new fields in config/staff/overrides):
- Check server.js handles the new fields
- Check the CLAUDE.md data model section matches

### 4. Verdict
Give a clear verdict:
- **PASS** — safe to commit, no issues found
- **WARN** — minor issues listed, safe to commit but consider fixing
- **FAIL** — blocking issues that must be fixed before committing

If FAIL, list each issue with the file and line number.
