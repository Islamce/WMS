# KYNOX WMS V2 — Phase 2 Scope

## Objective

Convert the existing dashboard into a practical Operations Command Center without changing warehouse transaction logic, database schema, or API contracts.

## Evidence available in the current product

The current frontend already consumes:

- `/api/dashboard` for stock, locations, materials, transaction trends, and recent transactions.
- `/api/kpi` for request status, processing time, shortages, expiry, QR scan outcomes, overrides, allocation method, and ERP posting success.

The phase therefore reuses these sources instead of inventing new data or introducing a new analytics backend.

## In scope

- Present the existing dashboard and KPI data in one prioritized operational view.
- Highlight actionable exceptions such as ERP errors, shortages, expired batches, open requests, and pending users.
- Preserve drill-through to existing source screens.
- Provide partial-failure handling when one data source is unavailable or the user lacks KPI permission.
- Retain the existing dashboard charts and recent transaction evidence.
- Add responsive styles for desktop and mobile.

## Out of scope

- Warehouse digital twin.
- Predictive models.
- New AI model integration.
- New database tables or API endpoints.
- Changes to request, receiving, picking, GI, or shipping workflows.
- SAP write-back or new integration middleware.

## Acceptance criteria

1. A user with dashboard permission can open the Command Center.
2. Existing dashboard information remains available.
3. KPI information appears only when the user has KPI permission and the endpoint succeeds.
4. Exceptions drill through to the existing requests, expiry, audit, users, and warehouse screens where permitted.
5. Failure of `/api/kpi` does not block stock dashboard data.
6. Failure of `/api/dashboard` produces a clear error state.
7. No backend, database, permission, or workflow behavior changes.
8. CI remains green.
9. Desktop, mobile, dark/light, English/Arabic, and RTL behavior are checked before merge.

## Rollback

Revert the Phase 2 pull request. The existing API and database remain unchanged.
