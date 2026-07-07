# WMS — Warehouse Management System

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

## Installation & setup

Requirements: Node.js 18+.

```bash
# 1. Install dependencies
npm install

# 2. Create the database schema and seed data (roles, permissions,
#    default admin, sample materials and locations)
npm run setup        # = npm run migrate && npm run seed

# 3. Start the server
npm start            # or: npm run dev (auto-restart on changes)
```

Open **http://localhost:3000**.

### Default admin login

| Email               | Password       |
|---------------------|----------------|
| `admin@example.com` | `Admin@123456` |

> Change this password (or replace the account) before any real deployment.

### Configuration

Copy `.env.example` to `.env` to override defaults:

```
PORT=3000
JWT_SECRET=change-me-to-a-long-random-string   # REQUIRED in production
JWT_EXPIRES_IN=8h
DB_PATH=./data/wms.db
```

### Database migration & seeding

- `npm run migrate` — creates all tables and indexes (idempotent).
- `npm run seed` — inserts roles, permission keys, the default admin, sample
  materials and locations (idempotent, safe to re-run).
- The SQLite database file lives at `data/wms.db` (git-ignored). Delete it and
  re-run `npm run setup` for a fresh start.

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

1. Add its permission key in `server/db/seed.js` (`PERMISSIONS`) and re-run
   `npm run seed`.
2. Create the API route in `server/routes/` protected with
   `requirePermission('your_key')` and mount it in `server/index.js`.
3. Create `public/js/pages/yourpage.js` registering `Pages.yourpage`, include
   it in `public/index.html`, and add entries to `MENU` and `ROUTE_PAGES`
   in `public/js/app.js`.
4. Grant the permission to roles/users from the admin screens.
