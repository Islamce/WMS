# Phase 2 Command Center — UAT Checklist

## Roles
Test once with an administrator and once with a restricted warehouse role.

## Core checks
- Open Dashboard and confirm the command center loads without console-visible failure.
- Confirm stock totals match the existing stock/batch screens.
- Confirm Stock IN and Stock OUT values match transaction records.
- Confirm ERP Error opens Requests filtered to ERP Error.
- Confirm Partially Completed opens Requests filtered accordingly.
- Confirm Failed QR Scans opens Audit with the QR failure action filter.
- Confirm Expired Batches opens the expiry screen.
- Confirm KPI-disabled user still sees stock monitoring and a clear KPI-unavailable notice.
- Press Refresh repeatedly and confirm charts do not duplicate.

## Responsive and accessibility smoke tests
- Desktop expanded sidebar.
- Desktop collapsed sidebar.
- Mobile navigation drawer.
- Keyboard Enter/Space on KPI and exception cards.
- Light and dark themes.
- English and Arabic/RTL.

## Pass condition
No data mismatch, unauthorized data exposure, broken route, duplicated chart, blocked workflow, or mobile overflow.
