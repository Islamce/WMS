# KYNOX WMS V2 — Implementation Sequence

## Phase 1A — Navigation and terminology

1. Reorder the sidebar using the approved navigation matrix.
2. Rename visible labels and page titles while preserving routes and permissions.
3. Update breadcrumb labels, command-palette search terms, and translated strings.
4. Add regression tests for route compatibility and permission gating.

## Phase 1B — KYNOX visual shell

1. Replace generic WMS theme tokens with KYNOX design tokens.
2. Update login, sidebar, top bar, page headers, cards, forms, tables, alerts, dialogs, empty states, and loading states.
3. Preserve light and dark mode, with dark-first presentation.
4. Validate desktop, tablet, mobile, RTL, keyboard, and accessibility behavior.

## Phase 1C — Process workspaces

1. Introduce consistent process headers and contextual actions.
2. Standardize queue filters, saved views, status chips, bulk actions, and detail drawers.
3. Add transaction timelines and material/request journey views.
4. Reduce duplicate tabs by linking related actions inside each workspace.

## Phase 2 — Guided execution

1. Receiving and quality workflow.
2. Put-away and location confirmation.
3. Allocation, picker assignment, and guided picking.
4. Reallocation and internal transfer.
5. Goods Issue and dispatch.
6. Mobile task parity and scan validation.

## Phase 3 — Inventory control

1. Annual physical inventory.
2. Cycle and spot counting.
3. Blind count and recount.
4. Variance investigation and approval.
5. Inventory accuracy, capacity, and count-performance dashboards.

## Phase 4 — Intelligence

1. ABC, XYZ, ABC-XYZ, and FSN.
2. Aging, expiry, slow/dead/excess stock.
3. Slotting, put-away, and reallocation recommendations.
4. Warehouse AI assistant with approval-only recommendations.

## Delivery rule

Each phase must be delivered through a dedicated branch and pull request with CI evidence, screenshots, acceptance checklist, and rollback notes before merge.