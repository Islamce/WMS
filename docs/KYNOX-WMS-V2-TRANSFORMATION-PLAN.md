# KYNOX WMS V2 — Transformation Strategy and Enhancement Plan

**Status:** Approved for execution  
**Date:** 2026-07-22  
**Product direction:** AI-driven Warehouse Execution and Supply Chain Operations Platform

## 1. Executive direction

KYNOX WMS will retain the capabilities already delivered in V1.0 and evolve through controlled, backward-compatible increments. The transformation is not a visual refresh only. It reorganizes the product around warehouse business processes, guided execution, inventory control, intelligence, and governed administration.

The implementation must preserve existing permissions, routes, APIs, audit controls, production backup controls, mobile compatibility, and current Material Request to Goods Issue workflow while improving discoverability and operator execution.

## 2. Verified capabilities already implemented

The current repository already includes:

- Enterprise application shell with collapsible hierarchical navigation, breadcrumbs, global search, theme control, and user menu.
- Dashboard, KPI dashboard, AI stock analytics, and notifications.
- Material request creation, approval, ERP operator processing, allocation, picker assignment, picking, and Goods Issue posting.
- Receiving, QR label printing, batch tracking, expiry alerts, quality, cycle count, stock reallocation, physical inventory, shipping, and outbound processing.
- Materials, warehouses, storage locations, bins, movement types, import/export, users, permissions, and append-only audit trail.
- Responsive web application and Android mobile application.
- Firebase notifications, API security controls, production health endpoint, backup and retention controls.

The strategy therefore focuses on reorganization, workflow maturity, usability, operational controls, analytics integration, and AI differentiation rather than recreating existing modules.

## 3. Target information architecture

### A. Command Center

1. Operations Overview
2. KPI Cockpit
3. Alerts and Notifications
4. AI Operations Center

### B. Demand and Requests

1. Create Material Request
2. Request Workspace
3. Approval Workbench
4. ERP Processing Queue

### C. Inbound Operations

1. Goods Receipt
2. Quality Inspection
3. Put-away
4. QR and Label Printing
5. Batch and Expiry Control

### D. Warehouse Execution

1. Execution Dashboard
2. Allocation and Reservation
3. Picker Assignment
4. My Tasks
5. Internal Transfer and Reallocation

### E. Outbound Operations

1. Picking Confirmation
2. Packing and Staging
3. Goods Issue
4. Delivery and Dispatch

### F. Inventory Control

1. Stock Overview
2. Physical Inventory
3. Cycle Counting
4. Location Utilization
5. Empty Locations
6. Variance Investigation

### G. Intelligence and Analytics

1. Inventory Health
2. ABC-XYZ Analysis
3. FSN and Aging
4. Slow, Dead, Excess, and At-risk Stock
5. Warehouse Capacity and Heat Maps
6. AI Recommendations

### H. Master Data and Integration

1. Materials
2. Warehouses
3. Storage Hierarchy and Bins
4. Units and Movement Types
5. Import Center
6. SAP and API Integration

### I. Governance and Administration

1. Users and Roles
2. Permissions
3. Approval Matrix
4. Notification Rules
5. Audit Trail
6. System Settings

## 4. Navigation redesign principles

- Navigation follows the physical warehouse lifecycle: demand → inbound → storage/execution → outbound → control → intelligence.
- Business terminology replaces technical or role-only labels where possible.
- Existing routes remain available to avoid breaking bookmarks, tests, and mobile deep links.
- Existing permissions remain the authority for visibility and action control.
- Group order is identical across desktop and mobile where the capability exists.
- Frequently used operator actions appear before analytical or configuration screens.
- Duplicate or overlapping tabs are consolidated into process workspaces.

## 5. KYNOX design system

### Visual direction

- Dark-first premium operational interface with optional light mode.
- Deep navy background, elevated graphite surfaces, cyan/blue operational accent, and controlled green/amber/red status colors.
- Subtle gradients and glass effects only on command-center and summary surfaces; transaction forms remain high-contrast and distraction-free.
- Consistent 8-point spacing system, 12–16 px radii, compact tables, strong hierarchy, and responsive cards.
- KYNOX brand treatment across login, sidebar, page headers, loading states, empty states, and reports.

### Core components

- Process header with title, stage indicator, status, primary action, and contextual actions.
- Operational KPI cards with target, actual, trend, and exception indicator.
- Work queues with saved views, search, filtering, sorting, and bulk actions.
- Guided task panel showing current step, required scans, validation, and next action.
- Material journey timeline for full transaction traceability.
- Exception drawer for shortages, batch/expiry conflicts, negative stock, and permission failures.
- Responsive data tables with sticky headers, density control, column chooser, export, and clear empty states.

## 6. Workflow enhancement requirements

### Inbound

- Introduce a controlled workflow: expected receipt → receipt confirmation → quality decision → label generation → put-away task → bin confirmation.
- Require material, quantity, UOM, batch/serial where applicable, destination warehouse, and document reference validation.
- Add over/under-delivery tolerances and exception approval.
- Generate put-away recommendations based on compatible bin, available capacity, item velocity, batch/expiry constraints, and fixed-bin rules.

### Internal execution

- Convert allocation, picker assignment, picking, and reallocation into queue-driven tasks.
- Add task priorities, due time, ownership, acceptance, start, pause, completion, rejection, and escalation.
- Enforce source-bin scan, material scan, quantity confirmation, destination-bin scan, and reason code for deviations.

### Outbound

- Introduce reservation → allocation → picking → staging/packing → Goods Issue → dispatch confirmation.
- Support partial picking, short pick, substitution approval, cancellation, and return to stock.
- Apply FIFO/FEFO and batch restrictions according to configuration.

### Inventory control

- Separate annual physical inventory, cycle count, spot count, and recount.
- Support blind count, freeze or controlled movement window, variance tolerance, recount, investigation, approval, and posting.
- Preserve complete audit trace from count creation to final adjustment.

## 7. Intelligence roadmap

### Near term

- ABC, XYZ, and combined ABC-XYZ classification.
- FSN, aging, expiry risk, excess stock, shortage risk, and non-moving stock.
- Location capacity and utilization dashboard.
- Inventory accuracy, picking accuracy, task aging, order cycle time, and warehouse productivity KPIs.

### Medium term

- Put-away and slotting recommendations.
- Reallocation recommendations between bins and warehouses.
- Predictive shortage and replenishment risk.
- Natural-language warehouse assistant grounded in authorized operational data.

### Strategic

- Process mining and bottleneck detection.
- Warehouse heat maps and travel-path optimization.
- IoT/RFID and smart-device integration.
- Digital warehouse twin and scenario simulation.

## 8. Delivery plan

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 | Information architecture and KYNOX shell | Navigation reordered, terminology standardized, responsive shell validated, routes and permissions preserved |
| 2 | Inbound and warehouse task UX | Guided receiving, allocation, picking, reallocation and scan validation pass end-to-end tests |
| 3 | Outbound and inventory control | Reservation-to-dispatch and controlled physical inventory workflows validated |
| 4 | Analytics and AI foundation | ABC-XYZ, aging, inventory health, utilization, exceptions and governed recommendations available |
| 5 | Integration and optimization | SAP/API contracts, device integrations, performance, security and production readiness completed |

## 9. Phase 1 implementation backlog

1. Reorder sidebar modules to the target business-process sequence.
2. Rename tabs and page titles without changing route identifiers.
3. Group receiving and quality under Inbound Operations.
4. Group allocation, picker assignment, task execution, and reallocation under Warehouse Execution.
5. Group Goods Issue and shipping under Outbound Operations.
6. Move physical inventory and cycle count into Inventory Control.
7. Move KPI and AI screens into Intelligence and Analytics.
8. Apply KYNOX design tokens to shell, cards, forms, tables, states, and login.
9. Add page-level process headers and contextual actions.
10. Update i18n labels and accessibility assertions.
11. Update smoke, navigation, permission, RTL, responsive, and axe tests.
12. Produce before/after screenshots and operator acceptance checklist.

## 10. Non-negotiable controls

- No direct development on `main`; all changes through reviewed pull requests.
- No breaking route, permission, API, schema, or mobile contract change without migration and regression tests.
- No inventory posting without atomic database transaction and audit record.
- No AI recommendation may post inventory automatically in the initial releases.
- No production merge until CI, smoke, accessibility, backup, and rollback checks pass.
- All critical operations must remain usable without AI services.

## 11. Definition of success

The transformation is successful when operators can identify and complete their daily work from task queues with fewer decisions and fewer navigation steps; supervisors have real-time visibility of workload and exceptions; inventory controllers have governed counting and variance workflows; management receives reliable inventory and warehouse KPIs; and the platform maintains auditable, secure, SAP-aligned execution.