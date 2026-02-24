---
allowed-tools: Bash(node:*), Bash(git status:*), Bash(git add:*), Bash(git diff:*), Bash(git log:*), Bash(git commit:*), Bash(git push:*), Read, Edit, Write, Grep, Glob
description: Run tests, fix all failures, and commit
---

## Your task

Find and fix all bugs in one pass:

1. Run all 3 test scripts (`test_rotation.js`, `test_costs.js`, `test_coverage.js`) and collect failures
2. For each failure, read the relevant source file, identify the bug, and fix it
3. Re-run the failing tests to confirm the fix works
4. Once all tests pass, commit with a message like "Fix N bugs: brief description of each"
5. Push to origin

Rules:
- Fix the actual bug, don't patch the test
- If a fix might break other things, run all tests again after fixing
- No co-author tags in commits
- If there are no failures, say "All tests pass — nothing to fix"
