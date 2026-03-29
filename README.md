# Panama Staffing

Care home staff scheduling and compliance platform using the Panama 2-2-3
rotation pattern. Built for UK residential care homes.

## Current Status

The current hardening baseline is documented in
[docs/HARDENING_SUMMARY_2026-03-29.md](docs/HARDENING_SUMMARY_2026-03-29.md).

Current verified local baseline:

- `npm test`: 134 files, 2533 tests passed
- `npm run build`: passed
- `npm run audit:routes`: passed
- `npm audit --omit=dev --json`: 0 vulnerabilities

Recent hardening work covered:

- auth/session invalidation, logout behavior, and per-home RBAC
- scheduling, dashboard, training, and bed/finance correctness fixes
- GDPR/export/privacy tightening and safer health/ops defaults
- broader integration, page, and browser coverage
- quieter test output and cleanup of the last known GDPR query concurrency warning

## Tech Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4, React Router 7
- **Backend**: Express 5 (Node.js 22), PostgreSQL
- **PDF**: `jspdf` + `jspdf-autotable`
- **Monitoring**: Sentry + Prometheus-style `/metrics`
- **Testing**: Vitest + Playwright

## Prerequisites

- Node.js 22+
- PostgreSQL 15+
- npm 10+

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/tb9922/panama-staffin.git
cd panama-staffin
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env, generate JWT_SECRET, and set DB credentials

# 3. Start PostgreSQL (via Docker or local install)
docker compose up -d

# 4. Run migrations
node scripts/migrate.js

# 5. Start development servers
npm run dev
# API: http://localhost:3001
# UI:  http://localhost:5173
```

Default logins: `admin / admin123` (edit), `viewer / view123` (read-only).

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start API + UI concurrently (`nodemon` + `vite`) |
| `npm run server` | Start API server only |
| `npm run client` | Start Vite dev server only |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |
| `npm test` | Run the main Vitest suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:integration` | Run integration tests |
| `npm run test:frontend` | Run frontend-focused tests |
| `npm run test:e2e` | Run Playwright browser tests |
| `npm run audit:routes` | Audit route definitions |

## Architecture

```text
server.js                 Express entry point
config.js                 Centralized environment config with fail-fast validation
db.js                     PostgreSQL connection pool + migration runner
logger.js                 Structured logging
metrics.js                Prometheus-style metrics registry
requestContext.js         Request-scoped context (reqId, homeSlug, username)

routes/                   HTTP endpoint definitions (34 top-level route modules)
services/                 Business logic layer
repositories/             Database access layer
middleware/               Auth, request context, access logging
migrations/               Numbered SQL migration files (001-131)
lib/                      Shared server utilities

src/                      React frontend
  pages/                  Route-level screens
  components/             Shared UI and extracted modal/state slices
  hooks/                  Shared React hooks
  lib/                    Client-side business logic and API wrappers
```

### Request Flow

```text
Client -> Route -> Service -> Repository -> PostgreSQL
                   |          |
                   |          +-- audit logging / row locking / OCC
                   +-- validation / business rules / request context
```

## API Overview

All endpoints require JWT authentication via `Authorization: Bearer <token>` or
the browser cookie/CSRF flow.

| Group | Prefix | Description |
|-------|--------|-------------|
| Auth | `/api/login` | Login, logout, token revocation |
| Homes | `/api/homes` | Home config and access |
| Dashboard | `/api/dashboard` | Aggregated KPIs and alerts |
| Scheduling | `/api/scheduling` | Overrides, rota, daily status |
| Staff | `/api/staff` | Staff register and onboarding-related data |
| Training | `/api/training` | Training records, types, compliance |
| Payroll | `/api/payroll` | Timesheets, runs, pensions, SSP, exports |
| Finance | `/api/finance` | Residents, invoices, expenses, beds |
| HR | `/api/hr` | Disciplinary, grievance, performance, contracts |
| GDPR | `/api/gdpr` | SARs, breaches, retention, consent |
| Export | `/api/export` | Controlled report/export data |
| Audit | `/api/audit` | Audit log and report downloads |

## Testing

```bash
npm test
npm run test:frontend
npm run test:e2e
npm run audit:routes
```

The current baseline is 2533 passing tests across 134 files, covering unit,
integration, route, page, and targeted browser flows.

## Key Docs

- [docs/HARDENING_SUMMARY_2026-03-29.md](docs/HARDENING_SUMMARY_2026-03-29.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/RUNBOOK.md](docs/RUNBOOK.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- [docs/AUTH.md](docs/AUTH.md)
- [docs/BACKUP_DRILL.md](docs/BACKUP_DRILL.md)

## Deployment

### Docker

```bash
docker build -t panama-staffing .
docker run -p 3001:3001 --env-file .env panama-staffing
```

The Dockerfile uses a multi-stage build: one stage builds the Vite frontend and
the final stage ships only the runtime dependencies and compiled assets.

### Environment Variables

See `.env.example` for the full list. Core required values:

- `JWT_SECRET`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `ALLOWED_ORIGIN`

Recommended production values now also include:

- `JWT_EXPIRES_IN`
- `DB_POOL_MAX`
- `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`
- `METRICS_TOKEN`
- `SENTRY_DSN`
- `SENTRY_TRACES_SAMPLE_RATE`
- `VITE_SENTRY_DSN`
- `VITE_SENTRY_TRACES_SAMPLE_RATE`
- `BACKUP_S3_BUCKET` or `BACKUP_SCP_TARGET`
- `VERIFY_AFTER_BACKUP`
- `HEALTHCHECK_URL`

## License

Private. Not for redistribution.
