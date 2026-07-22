# KYNOX WMS V2 — Phase 1 Acceptance Criteria

## Scope

Phase 1 covers information architecture, navigation terminology, KYNOX shell styling, responsive behavior, accessibility, and regression protection. It does not change inventory posting logic, database schema, API contracts, or permissions.

## Acceptance criteria

### Navigation

- Signed-in users land on the existing launchpad or an authorized command-center screen.
- Sidebar groups follow this order: Command Center, Demand & Requests, Inbound Operations, Warehouse Execution, Outbound Operations, Inventory Control, Intelligence & Analytics, Master Data & Integration, Governance & Administration.
- Existing hash routes continue to resolve.
- Existing permission keys continue to govern screen visibility.
- Active group opens automatically and active screen is visually clear.
- Search finds screens using both the new label and retained route terminology.

### Visual system

- Login, sidebar, top bar, page headers, cards, forms, tables, dialogs, alerts, empty states, and loading states use common KYNOX tokens.
- Dark and light modes meet readable contrast requirements.
- Status colors are used consistently for success, warning, error, blocked, pending, and informational states.
- Transaction pages prioritize clarity over decorative effects.

### Responsive and mobile web

- No horizontal page overflow at 360 px, 768 px, 1024 px, and 1440 px except inside intentional scrollable tables.
- Sidebar behaves as a drawer on small screens and preserves keyboard focus management.
- Primary actions remain visible and usable on mobile.
- Tables provide a compact or card fallback where necessary.

### Accessibility

- Keyboard navigation reaches all interactive elements.
- Visible focus is present.
- Navigation controls expose meaningful accessible names and expanded states.
- Forms retain associated labels, instructions, and validation messages.
- Automated axe checks report no serious or critical violations on the main flows.

### Regression

- Authentication and forced-password-change flows remain operational.
- Request-to-GI workflow remains operational.
- Receiving, reallocation, inventory count, shipping, administration, and notifications remain reachable under the same permissions.
- Existing automated tests pass.
- New tests cover navigation order, route compatibility, permission gating, responsive shell, dark/light themes, RTL, and accessibility.

## Evidence required before merge

- Green CI and smoke tests.
- Before/after screenshots at desktop and mobile breakpoints.
- Navigation matrix showing old label, new label, route, permission, and target group.
- Manual operator checklist for requester, approver, ERP operator, warehouse supervisor, picker, inventory controller, and administrator.
- Rollback note confirming that Phase 1 is UI-only and can be reverted without data migration.