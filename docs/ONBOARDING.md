# Onboarding

## Goal

Get a new engineer from clone to a safe first PR quickly, with the fewest moving
parts possible.

## 1. Prerequisites

- Node.js 22+
- npm 10+
- PostgreSQL 15+
- A copy of `.env` based on `.env.example`

## 2. First Run

```bash
git clone https://github.com/tb9922/panama-staffing.git
cd panama-staffing
npm install
docker compose up -d
node scripts/migrate.js
npm run dev
```

App URLs:

- API: `http://localhost:3001`
- UI: `http://localhost:5173`

## 3. Useful Commands

```bash
npm test
npm run test:frontend
npm run build
npm run audit:routes
```

If you are touching DB-backed behavior, run the relevant integration tests too.

## 4. Codebase Shape

- `routes/` HTTP handlers
- `repositories/` DB access
- `services/` transactional business logic
- `src/lib/api.js` frontend API wrappers
- `src/pages/` route-level screens

Canonical request path:

```text
DB -> Repository -> Service -> Route -> src/lib/api.js -> Page
```

## 5. Guardrails

- Home scope is query-param based, not path based.
- Prefer shared role/module checks over ad hoc admin checks.
- Keep writes transactional when data + audit must succeed together.
- Use `apply_patch` for manual file edits.
- Do not revert unrelated dirty-worktree changes.

## 6. Before Opening a PR

Minimum:

```bash
npm test
npm run test:frontend
npm run build
npm run audit:routes
```

Also do a manual smoke on the touched flow.
