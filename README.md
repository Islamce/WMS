# WMS — Warehouse Management System & Material Request / Goods Issue Platform

A clean, modular, ERP-agnostic warehouse execution platform. Phase 1 covers the
complete **Material Request → Approval → ERP Reservation → Warehouse Picking →
Goods Issue** workflow, on top of a base inventory module (materials, locations,
stock in/out, users, permissions).

## Material Request → Goods Issue workflow

Requester creates a request → Manager approves / modifies / partially approves /
rejects / returns (every change audited) → ERP Operator enters reservation/
reference, movement type, plant, storage location and issue warehouse (all
mandatory before routing) → Warehouse runs FIFO/FEFO batch+bin allocation →
Supervisor assigns a picker (with reminders + escalation until accepted) → Picker
accepts, scans QR per batch/bin (validated against material, batch, bin,
warehouse, expiry, quality), confirms each line (shortage reason mandatory on
partial) → Warehouse Operator posts Goods Issue in ERP → request closes as
Completed / Partially Completed / Closed with Shortage, or moves to ERP Error and
stays open until resolved.

Key building blocks:
- **Entities** — material_request_headers/lines, warehouses, bin_locations,
  batches, qr_codes, picking_tasks, picking_allocations, movement_types,
  audit_trail, notification_log, erp_integration_log (see `server/db/migrate2.js`).
- **Workflow engine** — 33 header statuses + guarded transitions (`server/workflow/states.js`).
- **Services** — FIFO/FEFO allocation, QR generation/validation, expiry
  calculation & alerts, notifications with reminder/escalation SLA, append-only
  audit, and a pluggable ERP connector (`server/services/*`).
- **ERP-agnostic integration** — the default `MANUAL` connector records payloads
  and accepts operator-keyed ERP numbers; swap in a SAP/Oracle/Dynamics connector
  implementing the same interface without touching the workflow.

### Development-only demo role accounts (password `Passw0rd!`)

> These seeded accounts are for disposable local development and test databases
> only. They must not be created or used in production.

| Role | Email |
|------|-------|
| Requester | requester@example.com |
| Manager | manager@example.com |
| ERP Operator | erp@example.com |
| Warehouse Supervisor | supervisor@example.com |
| Warehouse Operator | whoperator@example.com |
| Picker | picker@example.com |
| Quality | quality@example.com |
| Auditor | auditor@example.com |

The development seed also creates a default admin. Production deployments must
use an explicitly provisioned administrator and must not rely on seeded
credentials.

---

## Base inventory module

A clean, simple web application to control warehouse operations: materials,
locations, stock in/out with full transaction history, user management with
admin approval, and per-screen permissions.

## Tech stack

| Layer     | Technology |
|-----------|------------|
| Backend   | Node.js + Express |
| Database  | SQLite (better-sqlite3) — zero configuration, single file |
| Auth      | JWT (jsonwebtoken) + bcryptjs password hashing |
| Frontend  | Vanilla JS single-page app (no build step) + Chart.js |

No build tools, no external services — `npm install` and run.

## Features

- **Authentication** — signup creates a `pending` account; only admin-approved
  (`active`) users can login. Statuses: `pending`, `active`, `rejected`, `disabled`.
- **Authorization** — every screen has a permission key enforced on the backend
  (middleware) and the frontend (menu visibility + route guard). Admin manages
  role defaults and per-user grants.
- **Materials** — CRUD with search, pagination, unique item codes; deletion is
  blocked when stock or transactions exist.
- **Locations** — CRUD with unique codes; deletion blocked when stock or
  transactions exist.
- **Stock In / Stock Out** — material autocomplete, live total/per-location
  stock display, atomic database transactions, negative stock impossible,
  every movement logged in `stock_transactions`. Stock out requires a
  reservation number and is limited to locations holding the material.
- **All / Empty Locations** — occupancy overview and empty-location report.
- **Dashboard** — KPIs (materials, locations, occupancy, stock in/out today &
  month, pending users), top-10 lists, recent transactions, and charts
  (IN vs OUT over time, stock by group, by location, transactions by user).

## Test on GitHub Codespaces

This repo ships a devcontainer, so testing on GitHub needs no manual setup:

1. On the repo page: **Code ▸ Codespaces ▸ Create codespace**. The container
   installs dependencies and creates + seeds the database automatically.
2. In the Codespace terminal, run:
   ```bash
   npm start
   ```
3. Open the app: the **Ports** tab auto-forwards port **3000** — click the
   globe/preview icon to open it. (Opening the forwarded URL *inside* the
   Codespace is authenticated, so it won't 401.)
4. To share the URL with someone else, set port 3000's visibility to **Public**
   (Ports tab ▸ right-click the port ▸ *Port Visibility ▸ Public*). A private
   port returns **HTTP 401** to anyone not signed in to your Codespace.
5. Log in with `admin@example.com` / `Admin@123456`.

Health check: `https://<your-codespace>-3000.app.github.dev/healthz` returns
`{"status":"ok"}` when the app is up — a 200 here with a 401 on `/` means the
port is still Private, not an app problem.

## Local development installation & setup

Requirements: Node.js 18+.

```bash
# 1. Install dependencies
npm install

# 2. Create a disposable local database and development seed data
npm run setup        # = npm run migrate && npm run seed

# 3. Start the server
npm start            # or: npm run dev (auto-restart on changes)
```

Open **http://localhost:3000**.

### Development-only admin login

| Email               | Password       |
|---------------------|----------------|
| `admin@example.com` | `Admin@123456` |

> Never use this account or password in production.

### Configuration

Copy `.env.example` to `.env` to override defaults:

```
PORT=3000
JWT_SECRET=change-me-to-a-long-random-string   # REQUIRED in production
JWT_EXPIRES_IN=8h
DB_PATH=./data/wms.db
SKIP_AUTO_SEED=1
ALLOW_AUTO_SEED=0
PRODUCTION_INITIALIZATION_ENABLED=false
```

### Testing & CI

```bash
npm test        # full end-to-end suite (282 checks) — needs Node 18+ and python3
npm run lint    # ESLint + eslint-plugin-security (0 errors)
npm audit --omit=dev --audit-level=high   # production dependency audit
npm run test:smoke  # Playwright smoke: login + shell + axe a11y gate, no console errors
```

The runner (`tests/run.sh`) rebuilds a fresh database, boots the server, and
executes the workflow regression (25 scenarios), UI-refinement checks, P0
regressions (reservation-leak, login rate-limit, JWT guard), P1 regressions
(self-approval block, dashboard→batches stock source, return-to-picker
allocation restore, security headers, body limit), the P0/P1 hardening suites
(forced password change, reservation timeout, backup snapshot; async-bcrypt
paths, audit append-only triggers, migration versioning, scheduler lease), and
the feature suite (AI analytics, PDF labels, mass upload, quality step, CSV
import).
GitHub Actions (`.github/workflows/ci.yml`) runs the same command on every
push to `main` and on every pull request, plus ESLint (with
`eslint-plugin-security`) and a production `npm audit`. `Dependabot`
(`.github/dependabot.yml`) keeps dependencies and Actions patched.

> **CodeQL (SAST):** enable it via GitHub's **default setup**
> (repo *Settings ▸ Code security ▸ CodeQL analysis ▸ Set up ▸ Default*).
> The default setup needs no workflow file and runs cleanly; a committed
> advanced-setup workflow fails on repositories without GitHub Advanced
> Security, so this repo intentionally does not ship one.

### Deploying to Hostinger

See **[DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md)** for step-by-step instructions
covering a Hostinger VPS (Docker via `docker-compose.yml`, or PM2 via
`ecosystem.config.js`) and shared hosting with the hPanel Node.js app (the root
`app.js` is the Passenger startup file). The app honours `PORT`/`NODE_ENV`/
`JWT_SECRET`/`DB_PATH` from the environment and sets `trust proxy` so it runs
correctly behind Hostinger's reverse proxy.

### Production notes

- `NODE_ENV=production` **requires** a real `JWT_SECRET` (≥ 32 chars, not the
  example placeholder) — the server refuses to boot otherwise.
- Production must set `SKIP_AUTO_SEED=1`, `ALLOW_AUTO_SEED=0`, and
  `PRODUCTION_INITIALIZATION_ENABLED=false`. A missing or empty database is a
  stop-and-investigate incident; restore the correct persistent database rather
  than creating users or demo data.
- Login is rate-limited: 10 failed attempts per email/IP per 15 minutes.
- Security headers are set by `helmet` (CSP, `X-Content-Type-Options`, etc.);
  the CSP allows only same-origin scripts (no inline handlers).
- Segregation of duties: a user can never approve or modify their own material
  request; and the three control points (approve → create ERP reservation →
  post goods issue) must be performed by three different people (admin exempt).
- Goods Issue reversal returns issued stock to its batches and closes the
  request as Reversed (movement-type reversal, reason mandatory).
- Approval matrix: high-value requests (see `approval_thresholds`) require an
  approver holding `approvals_high_value`.
- Optional email notifications (SMTP via `nodemailer`, logged fallback),
  request attachments, cycle counting, and configurable data retention for
  operational logs (`RETENTION_DAYS`; the audit trail is never pruned).
- Passwords must be ≥8 chars with a letter and a digit; a coarse global API
  rate limit (`API_RATE_LIMIT`) complements the per-email login limiter.
- Provision production administrators through the approved access-recovery
  procedure; do not deploy seeded or default credentials.
- Passwords are hashed asynchronously on the request path (login, signup,
  change, admin reset); an unknown-email login still runs a dummy bcrypt
  compare so response timing can't be used to enumerate accounts.
- The `audit_trail` table is append-only at the database level — triggers
  reject any `UPDATE`/`DELETE`, so history cannot be rewritten or erased.
- Schema changes are tracked in `schema_migrations` (see
  `server/db/migrations.js`); a plan for moving to PostgreSQL when you outgrow
  a single file lives in [docs/POSTGRES-MIGRATION.md](docs/POSTGRES-MIGRATION.md).
- API request logging to stdout (`LOG_REQUESTS`); enable automated daily
  SQLite backups with `BACKUP_DIR` (or `npm run backup`); stale stock
  reservations auto-release after `RESERVATION_TTL_HOURS` (default 24h). The
  background scheduler is safe to run on every instance — a per-job DB lease
  makes each tick single-runner — or disable it per process with
  `SCHEDULER_ENABLED=0`.


### Database migration & development seeding

- `npm run migrate` — creates all tables and indexes (idempotent).
- `npm run seed` — development/test only; inserts roles, permission keys,
  default users, and sample data into a disposable database.
- `npm run setup` — development/test only; runs migration and seed together.
- Production deployment runs `npm run migrate` only. Never run `seed`, `setup`,
  `fresh-start`, or `reset-admin` as a deployment step.
- The SQLite database file lives at `data/wms.db` by default (git-ignored).
  Production must use a verified persistent absolute `DB_PATH` and must never
  delete or replace the database during an application update.

## Project structure

```
WMS/
├── server/
│   ├── index.js                # Express entry point, static + API wiring
│   ├── config.js               # env-based configuration
│   ├── db/
│   │   ├── connection.js       # SQLite connection (WAL, foreign keys)
│   │   ├── migrate.js          # schema (tables + indexes)
│   │   └── seed.js             # roles, permissions, admin, sample data
│   ├── middleware/
│   │   └── auth.js             # authenticate (JWT) + requirePermission
│   ├── utils/
│   │   └── validate.js         # shared input validation helpers
│   └── routes/
│       ├── auth.js             # signup, login, me
│       ├── users.js            # admin user management + user permissions
│       ├── permissions.js      # permission keys + role permissions
│       ├── materials.js        # materials CRUD + autocomplete search
│       ├── locations.js        # locations CRUD + overview + empty report
│       ├── stock.js            # stock in / out + transaction history
│       └── dashboard.js        # KPIs and chart data
├── public/
│   ├── index.html              # SPA entry
│   ├── css/styles.css          # admin theme (responsive)
│   └── js/
│       ├── api.js              # fetch wrapper with JWT handling
│       ├── ui.js               # toasts, modals, pagination, autocomplete
│       ├── app.js              # router, layout, permission-based menu
│       └── pages/              # one file per screen
└── data/                       # SQLite database (created at runtime)
```

## Database schema

Tables: `users`, `roles`, `permissions`, `role_permissions`,
`user_permissions`, `materials`, `locations`, `material_location_stock`,
`stock_transactions`.

Key constraints:
- `materials.item_code` and `locations.code` are unique.
- `material_location_stock` has a unique `(material_id, location_id)` pair and
  a `CHECK (quantity >= 0)` — stock can never go negative.
- `stock_transactions` is the immutable movement log (never deleted by the app).
- Indexes on `materials.item_code`, `locations.code`,
  `stock_transactions.material_id / location_id / transaction_date`,
  `material_location_stock.material_id / location_id`.

## API overview

All routes are JSON under `/api`, authenticated with `Authorization: Bearer <token>`
except signup/login. Permission keys are enforced per route.

| Method | Route | Permission |
|--------|-------|------------|
| POST | `/api/auth/signup` | — |
| POST | `/api/auth/login` | — |
| GET  | `/api/auth/me` | authenticated |
| GET  | `/api/users` · PATCH `/api/users/:id/status` · PATCH `/api/users/:id/role` | `users_management` |
| GET/PUT | `/api/users/:id/permissions` | `users_management` |
| GET | `/api/permissions` · GET/PUT `/api/permissions/roles/:id` | `permissions_management` |
| GET/POST/PUT/DELETE | `/api/materials` | `materials` |
| GET | `/api/materials/search?q=` | `materials` / `stock_in` / `stock_out` |
| GET/POST/PUT/DELETE | `/api/locations` | `locations` |
| GET | `/api/locations/all` | `locations` / `stock_in` / `stock_out` |
| GET | `/api/locations/overview` | `all_locations` |
| GET | `/api/locations/empty` | `empty_locations` |
| GET | `/api/stock/material/:id/summary` | `stock_in` / `stock_out` |
| POST | `/api/stock/in` | `stock_in` |
| POST | `/api/stock/out` | `stock_out` |
| GET | `/api/stock/transactions` | `stock_in` / `stock_out` / `dashboard` |
| GET | `/api/dashboard` | `dashboard` |

## Extending the system

To add a new screen:

1. Add its permission key in `server/db/seed.js` (`PERMISSIONS`). Refresh a
   disposable development database with `npm run seed`; production permission
   changes require a reviewed migration or governed administrative procedure.
2. Create the API route in `server/routes/` protected with
   `requirePermission('your_key')` and mount it in `server/index.js`.
3. Create `public/js/pages/yourpage.js` registering `Pages.yourpage`, include
   it in `public/index.html`, and add entries to `MENU` and `ROUTE_PAGES`
   in `public/js/app.js`.
4. Grant the permission to roles/users from the admin screens.
