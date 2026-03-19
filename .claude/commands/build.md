---
name: build
description: "Autonomous implementation pipeline. Takes a task description, plans with experienced-dev thinking, validates against panama-architecture patterns and the live codebase, implements, reviews, debugs, tests, and verifies — all without stopping to ask. Use this for any feature, bug fix, or module that needs to be built end-to-end. Invoke as: /build <description of what to build>"
---

# Build Pipeline — Autonomous Implementation

You are running the full build pipeline. Execute every phase below in sequence. Do NOT stop to ask the user between phases — only stop if you hit a genuine blocker that requires a decision you cannot make.

## Phase 0: Load Context

1. Read `~/.claude/commands/experienced-dev.md` — activate senior dev thinking for the entire session
2. Read `.claude/commands/panama-architecture.md` — load all patterns, templates, anti-patterns
3. Read `CLAUDE.md` — load current codebase state (file counts, known issues, module inventory)
4. Check memory files if the task relates to prior work

You now have the full engineering framework + architecture patterns + current state. Keep all three active throughout.

## Phase 1: Plan

1. Understand the user's task description. If it's ambiguous, make the most reasonable interpretation based on existing codebase patterns — do NOT ask.
2. Explore the codebase to understand what exists:
   - Use Explore agents to find related files, existing patterns, reusable code
   - Read the actual files that will be modified or that the new code will integrate with
   - Check `shared/roles.js` for which RBAC module applies
3. If the task involves UK regulations (CQC, GDPR, employment law, HMRC, NMW, WTR, RIDDOR, etc.), search online to verify current requirements. Do NOT guess regulatory details from memory.
4. Design the implementation:
   - Follow panama-architecture layering: migration → repo → service → route → API wrapper → page
   - Identify every file that needs to be created or modified
   - Check the wiring checklist (Section 13 of panama-architecture)
   - Note which existing components, hooks, and utilities to reuse
5. Write the plan to the todo list so the user can see progress.

## Phase 2: Implement

Work through the plan systematically. For each file:

1. **Before writing:** Re-read the panama-architecture template for that layer (repo template, route template, page template, etc.)
2. **While writing:** Follow every rule — home_id scoping, soft deletes, version increment, settable whitelist, parameterised queries, design tokens, canWrite not isAdmin, _version before Zod, etc.
3. **After writing:** Mentally verify against the Common Mistakes table (Section 14). If you catch a violation, fix it immediately.

Order of implementation:
- Migration first (schema must exist)
- Repository (data layer)
- Service (business logic)
- Route (HTTP + auth + validation + audit)
- Mount in server.js
- API wrappers in src/lib/api.js
- Frontend page
- Navigation + routing wiring
- Tests

Update the todo list as each piece completes.

## Phase 3: First Review (Dev Review)

Run a dev-review against everything you just wrote. This is NOT optional and NOT skimmable. Execute EVERY check below with actual code reads, greps, and traces — not mental shortcuts.

### Standard checks (per file):
- Security: auth middleware correct? home_id scoped? input validated? no SQL injection? no PII in logs?
- Reliability: error handling? null guards? what if DB down? concurrent access?
- Patterns: matches panama-architecture templates? design tokens? Modal component? apiFetch?
- RBAC: requireModule with correct module and level? canWrite on frontend? nav filtering?
- Optimistic locking: _version extracted before Zod? version increment in repo? 409 on stale?
- Audit: every mutation route logs to audit service?
- Care home context: GDPR implications? availability impact? scale to 24 homes?

### Cross-boundary checks (MANDATORY — run with actual grep/read, not mental):

1. **Page → route auth for every role.** For each page you touched: find its RequireModule in AppRoutes.jsx. List every API call in load() and handlers. For each, grep the route file for the middleware chain. Check: can every role that passes RequireModule also pass the route auth? Run `grep` to verify — do not assume.

2. **Sibling functions.** If you changed one function (e.g. added snapshot to generateEvidencePackPDF), grep for ALL functions with similar signatures in the same file and related files. Check each one. Run `grep` to find them.

3. **Pre-existing code in modified files.** Read the WHOLE function you modified, not just your diff. Check the lines above and below your change for existing bugs.

4. **Initial state / first render.** For every new useState you added, check: what does the scorer/renderer produce when this value is null/[]/0? Run through the first render path mentally with those default values.

5. **Both sides of data changes.** If a record can change its parent (e.g. invoice.resident_id), verify: new parent validated (same home), totals recalculated for BOTH old and new.

6. **Live view = snapshot scorer + data.** If you changed a scoring model or data path, trace BOTH: (a) live page → scorer → data sources, (b) server snapshot → scorer → data sources. Every field must match.

7. **Status workflow bypass.** If any Zod schema includes a `status` field, check: can a caller set it directly via the generic create/update path? Status should only change via dedicated routes.

### Output:
List every issue found. Classify as: **Blocking** (security, data loss, crash), **Serious** (wrong pattern, missing validation), **Minor** (style, naming). Fix ALL blocking and serious issues immediately.

## Phase 4: First Debug

1. Run `npm test` — capture all failures
2. If test files exist for the module, run those specifically
3. For each failure:
   - Read the error message and stack trace
   - Read the failing code
   - Identify root cause (don't guess — trace the actual execution path)
   - Fix the bug
   - Re-run the specific failing test to confirm
4. If no test file exists for the new module, write one following the testing patterns (Section 11)
5. Run `npm test` again to confirm zero failures

## Phase 5: Wiring & Integration Check

Verify end-to-end flow manually:

1. **Backend wiring:**
   - Route file is imported and mounted in server.js
   - Middleware chain is correct: requireAuth → requireHomeAccess → requireModule
   - All CRUD endpoints exist (GET list, GET by id, POST create, PUT update, DELETE soft-delete)
   - Response shapes match what frontend expects ({ rows, total } for lists, shaped entity for CRUD)

2. **Frontend wiring:**
   - API wrappers exist in src/lib/api.js for every endpoint
   - Page component imports from correct paths
   - Page is lazy-loaded in AppRoutes.jsx with RouteErrorBoundary
   - Navigation entry exists in navigation.js with correct module for RBAC
   - RequireModule wrapper on route if needed

3. **Cross-module integration:**
   - If this module reads from other modules: LEFT JOIN or API call, never direct writes
   - If other modules will read from this: shapes are consistent, null handling works
   - Dashboard alerts wired if applicable

4. **Data flow:**
   - Create flow: form → API wrapper → route → service → repo → DB → shaped response → state update → re-render
   - Update flow: same + _version sent and checked
   - Delete flow: soft delete → re-fetch → removed from list
   - Filter/search flow: query params → repo WHERE clauses → filtered results

Fix any gaps found.

## Phase 6: Second Review

Run dev-review again on the COMPLETE set of changes (including all fixes from phases 3-5). This is the second pass — it catches issues introduced by the fixes themselves.

1. `git diff` to see everything that changed
2. Review with fresh eyes — pretend you're seeing this code for the first time
3. Re-run ALL 7 cross-boundary checks from Phase 3 against the full diff — not just the new fixes
4. Check for issues introduced by the fixes themselves
5. Verify no pattern drift between files (consistency)
6. Fix anything found

Do NOT skip the cross-boundary checks on the second pass. The first pass catches implementation bugs. The second pass catches integration bugs that only appear when all fixes are combined.

## Phase 7: Second Debug

1. Run `npm test` — must be zero failures
2. Run `npm run audit:routes` if route files were changed — must pass
3. If there are E2E tests related to this module, run those
4. Fix any failures

## Phase 8: Final Verify

Run the verify checklist:

1. **Tests pass:** `npm test` — zero failures
2. **Route audit:** `npm run audit:routes` — clean (if routes changed)
3. **No console.log left:** grep for console.log in changed files
4. **No hardcoded values:** config values in config.js, not inline
5. **Design tokens used:** no raw Tailwind in new pages
6. **Imports clean:** no unused imports, no wrong paths
7. **Git status clean:** only intentional changes staged

## Phase 9: Report

Give the user a concise summary:

1. **What was built** — one paragraph
2. **Files created/modified** — list with paths
3. **How to test it** — specific steps (navigate to page, create a record, etc.)
4. **Regulatory notes** — if any online checks were done, summarize findings
5. **Known limitations** — if any, be honest

Do NOT commit or push. The user will decide when to commit.

---

## Rules For The Entire Pipeline

- **No stopping:** Execute all phases without asking for permission between them. Only stop if you genuinely cannot proceed without user input (e.g., unclear which of two valid approaches to take for a business decision).
- **Fix forward:** When you find an issue, fix it immediately. Don't just report it.
- **Experienced-dev thinking:** Every decision through the lens of "what would a senior dev with 20 years experience do?" Paranoia > optimism. Simplicity > cleverness.
- **Panama patterns:** Every line of code must match the templates in panama-architecture. If you're tempted to deviate, re-read the anti-patterns table first.
- **Care home context:** Always active. GDPR special category data. 24/7 availability. CQC auditability. Scale to 24 homes.
- **Online checks:** If the task involves UK regulations, DO verify current requirements online. Don't rely on training data for statutory rates, deadlines, or legal thresholds.
- **Test coverage:** If tests don't exist, write them. If they exist and fail, fix the code (not the tests, unless the test is genuinely wrong).
