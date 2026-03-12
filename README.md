# Panama Staffing

Care home staff scheduling and compliance platform using the Panama 2-2-3 rotation pattern. Built for UK residential care homes.

## Tech Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4, React Router 7
- **Backend**: Express 5 (Node.js 22), PostgreSQL
- **PDF**: jspdf + jspdf-autotable
- **Monitoring**: Sentry
- **Testing**: Vitest

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
# Edit .env — generate JWT_SECRET and set DB credentials
# See .env.example for all required variables

# 3. Start PostgreSQL (via Docker or local install)
docker compose up -d   # if using the included compose file

# 4. Run migrations
node -e "import('./db.js').then(m => m.default.query('SELECT 1'))"
# Migrations run automatically on server start

# 5. Start development servers
npm run dev
# API:  http://localhost:3001
# UI:   http://localhost:5173
```

Default logins: `admin / admin123` (edit), `viewer / view123` (read-only).

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start API + UI concurrently (nodemon + vite) |
| `npm run server` | Start API server only |
| `npm run client` | Start Vite dev server only |
| `npm run build` | Production build (Vite) |
| `npm run lint` | ESLint check |
| `npm test` | Run unit tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:integration` | Run integration tests (requires running DB) |
| `npm run audit:routes` | Audit route definitions |

## Architecture

```
server.js                 Express entry point — mounts all route modules
config.js                 Centralised environment config with fail-fast validation
db.js                     PostgreSQL connection pool + auto-migration runner
logger.js                 Structured logging (Winston/Sentry)

routes/                   HTTP endpoint definitions (26 route modules)
services/                 Business logic layer
repositories/             Database access (one repo per domain table)
middleware/               Auth (JWT), access logging
migrations/               Numbered SQL migration files (001–081)
lib/                      Shared server utilities (pagination, Zod helpers, rate limiter)

src/                      React frontend
  App.jsx                 Shell: sidebar nav, auth, undo/redo, multi-home selector
  lib/                    Client-side business logic (rotation, escalation, accrual, CQC, etc.)
  pages/                  One component per route (~45 pages)
  hooks/                  Shared React hooks (useDirtyGuard, etc.)
  components/             Shared UI components (ErrorBoundary, Modal, Pagination, etc.)
```

### Request Flow

```
Client  ->  Route  ->  Service  ->  Repository  ->  PostgreSQL
                          |
                     Zod validation
                     Business rules
                     Audit logging
```

## API Overview

All endpoints require JWT authentication via `Authorization: Bearer <token>`.

| Group | Prefix | Description |
|-------|--------|-------------|
| Auth | `/api/login` | Login, logout, token revocation |
| Homes | `/api/homes` | Home CRUD, multi-home management |
| Staff | `/api/homes/:slug/staff` | Staff register, roles, rates |
| Scheduling | `/api/homes/:slug/scheduling` | Overrides, daily status, rotation |
| Training | `/api/homes/:slug/training` | Training records, types, compliance |
| Incidents | `/api/homes/:slug/incidents` | Incident reporting, CQC/RIDDOR tracking |
| Complaints | `/api/homes/:slug/complaints` | Complaints and satisfaction surveys |
| Maintenance | `/api/homes/:slug/maintenance` | Environment checks, certificates |
| IPC | `/api/homes/:slug/ipc` | Infection prevention audits, outbreaks |
| Risks | `/api/homes/:slug/risks` | Risk register, actions, reviews |
| Policies | `/api/homes/:slug/policies` | Policy review tracking |
| Whistleblowing | `/api/homes/:slug/whistleblowing` | Speak-up concerns |
| DoLS | `/api/homes/:slug/dols` | DoLS/LPS applications, MCA assessments |
| Care Certificate | `/api/homes/:slug/care-cert` | 16-standard progress tracking |
| Payroll | `/api/homes/:slug/payroll` | Timesheets, pay rates, runs, agency |
| HR | `/api/homes/:slug/hr` | Disciplinary, grievance, performance, absence, contracts |
| Finance | `/api/homes/:slug/finance` | Income, expenses, receivables, payables |
| GDPR | `/api/homes/:slug/gdpr` | Data requests, breaches, retention, consent |
| CQC Evidence | `/api/homes/:slug/cqc-evidence` | Quality statements, compliance scoring |
| Dashboard | `/api/homes/:slug/dashboard` | Aggregated KPIs and alerts |

## Testing

```bash
# Unit tests (no DB required)
npm test

# Integration tests (requires running PostgreSQL with test DB)
npm run test:integration
```

Unit tests cover field mappers, business logic (Bradford scores, working-day calculations), and validation schemas.

## Deployment

### Docker

```bash
docker build -t panama-staffing .
docker run -p 3001:3001 --env-file .env panama-staffing
```

The Dockerfile uses a multi-stage build: stage 1 builds the Vite frontend, stage 2 copies only production dependencies and compiled assets.

### Environment Variables

See `.env.example` for the full list. Required:

- `JWT_SECRET` -- 64-char hex string for token signing
- `ADMIN_PASSWORD_HASH` / `VIEWER_PASSWORD_HASH` -- bcrypt hashes
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` -- PostgreSQL connection
- `ALLOWED_ORIGIN` -- CORS whitelist (e.g. `http://localhost:5173`)

## License

Private. Not for redistribution.
