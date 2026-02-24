---
allowed-tools: Read, Edit, Grep, Glob, Bash(git diff:*)
description: Post-implementation code cleanup
---

## Pre-computed context

```bash
$ git diff --name-only
```

## Your task

Review and simplify the files changed in this session (listed above). For each changed file:

1. Remove dead code, unused imports, and unreachable branches
2. Simplify overly complex logic — fewer lines, clearer intent
3. Consolidate duplicate code within the file
4. Ensure design tokens from `src/lib/design.js` are used (no ad-hoc Tailwind button/card/table/modal classes)
5. Check that date handling uses `formatDate()` / `parseDate()` / `addDays()` from rotation.js

Rules:
- Only touch files that were changed in this session (from git diff above)
- Don't change functionality — same inputs, same outputs
- Don't add comments, docstrings, or type annotations unless the logic is genuinely unclear
- Don't add error handling for impossible cases
- Don't create abstractions for one-off code
- If the code is already clean, say so and stop
