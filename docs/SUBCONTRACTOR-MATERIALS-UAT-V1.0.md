# Subcontractor Material Receiving — UAT Checklist (v1)

Covers PR #96: the SAP-free subcontractor receiving stream (site/project
warehouses) plus the dashboard control-tower pipeline/sparklines shipped in
the same PR. Test users (seeded, password `Passw0rd!`):

| Role | Email | Use for |
|---|---|---|
| Site Warehouse Supervisor | `supervisor@example.com` | Log deliveries, administer subcontractors/categories, view stock |
| Site Quality Supervisor | `quality@example.com` | Inspect/decide delivery lines, view stock |
| Admin | any admin account | Full access to both, plus a negative-permission baseline |
| Requester (no subcontractor permission) | `requester@example.com` | Confirms the module is fully invisible without permission |

## Setup

1. Log in as **Site Warehouse Supervisor**. Go to **Subcontractor Materials → Subcontractors & Categories**.
2. Add a subcontractor (e.g. "ACME Electrical", trade "Electrical").
3. Add a category (e.g. "Consumables").
4. Confirm both appear in their respective tables with no console error.

## Scenario 1 — Logging a delivery (Warehouse Supervisor)

1. Go to **Subcontractor Materials → Deliveries & Quality**. Confirm the **+ Log Delivery** button is visible.
2. Click it, select a warehouse and the subcontractor created above, add two lines:
   - "PVC conduit 20mm", qty 100, unit M, category Consumables
   - "Junction box", qty 20, unit EA, category Consumables
3. Submit. Confirm the delivery appears in the queue as **DEL-#**, status **Pending Inspection**, with a "2 pending" line-count note.
4. Try submitting a delivery with a blank description or a zero/negative quantity — confirm the API rejects it with a clear error and no partial delivery is created.

## Scenario 2 — Role separation is enforced

1. Still as **Warehouse Supervisor**, open the delivery just logged. Confirm **no** Approve/Remarks/Reject buttons are visible on any line (view-only for this role).
2. Log out, log in as **Site Quality Supervisor**. Go to **Deliveries & Quality**. Confirm the **+ Log Delivery** button is **not** present.
3. Confirm the delivery from Scenario 1 is visible in the same queue with both lines still Pending.

## Scenario 3 — Quality decisions post directly to stock

1. As **Quality Supervisor**, open the delivery, click **Approve** on the conduit line, leave quantity approved at 100, submit.
2. Immediately go to **Subcontractor Materials → On-Hand Stock** (no separate receiving step). Confirm "PVC conduit 20mm" shows **100** on hand for the warehouse used.
3. Return to the delivery detail. Confirm the line now shows badge **Approved** with "(100 appr.)".
4. Click **Reject** on the junction-box line. Confirm a note is required (submitting with an empty note is blocked) — provide one (e.g. "Damaged boxes") and submit.
5. Confirm the delivery header status rolls to **Received** (not "Closed", since at least one line was approved).
6. Confirm rejected quantity does **not** appear anywhere in On-Hand Stock.

## Scenario 4 — Partial approval

1. Log a new delivery with one line, qty 50.
2. As Quality, choose **Approved with Remarks**, set quantity approved to 30 (less than delivered), with a note explaining the shortfall (e.g. "20 units water-damaged").
3. Confirm On-Hand Stock increases by exactly 30 for that description, not 50.

## Scenario 5 — All lines rejected

1. Log a delivery with a single line.
2. As Quality, reject it with a note.
3. Confirm the delivery header status becomes **Closed** (not "Received").
4. Confirm nothing was added to On-Hand Stock from this delivery.

## Scenario 6 — Guardrails

1. As Quality, attempt to submit a decision on a line that was already decided in an earlier scenario (re-open its delivery detail, if a decide button is somehow re-shown, or via direct action if available). Confirm the system refuses — a line's decision is final and cannot be redone.
2. As Warehouse Supervisor, attempt to log a delivery against a subcontractor that has been deactivated (mark one inactive via Subcontractors & Categories, if edit is available, or skip if v1 has no deactivate UI) — confirm inactive subcontractors don't appear in the delivery-logging picker.
3. Confirm quantity approved can never exceed quantity delivered (try entering more than delivered on an Approve/Remarks decision — should be rejected).

## Scenario 7 — Visibility and permissions baseline

1. Log in as **Requester** (no subcontractor permission). Confirm the **Subcontractor Materials** section does not appear in the sidebar at all, and navigating directly to `#/subcontractor-quality`, `#/subcontractor-stock`, or `#/subcontractors` is blocked (redirected or denied), not silently empty.
2. Log in as **Admin**. Confirm all three subcontractor screens are visible and fully usable (admin bypasses per-permission checks).

## Scenario 8 — Filters and multi-warehouse

1. If more than one warehouse exists, log deliveries against two different warehouses.
2. On the Deliveries & Quality queue, use the warehouse filter — confirm only that warehouse's deliveries show.
3. On On-Hand Stock, filter by warehouse — confirm quantities don't bleed across warehouses.
4. Use the status filter (Pending Inspection / Received / Closed) — confirm it narrows the list correctly.

## Scenario 9 — Audit trail

1. As an admin/auditor, open **Audit Trail**.
2. Confirm entries exist for: subcontractor/category creation, delivery creation (`SubcontractorDelivery` / `CREATE`), each quality decision (`SubcontractorDeliveryLine` / `QUALITY_DECISION`), and each resulting stock post (`SubcontractorReceipt` / `CREATE`) — each attributed to the correct user.

## Scenario 10 — Dashboard control-tower additions (same PR)

1. Log in with `kpi_dashboard` permission and open the **Dashboard**.
2. Confirm a **Fulfillment pipeline** strip renders above "Action required" with six stages (Intake, Approval, Picking, GI posting, Completed, Attention) and real counts (not all zero unless the DB genuinely has no requests).
3. Click a pipeline stage — confirm it navigates to **Requests**, pre-filtered where applicable.
4. Confirm the "Stock in today" / "Stock out today" KPI tiles show a small trend sparkline in the bottom-right corner.
5. Confirm the "Action required" exception cards each show a small status tag (Critical / Needs review / Clear) above the title.

## Accessibility & responsive smoke

- Tab through the Deliveries & Quality queue and the pipeline strip — every clickable row/node must be keyboard-reachable and show a visible focus ring.
- Desktop (1440px), tablet (820px), and mobile (390px) — tables and the pipeline strip must not overflow the viewport (horizontal scroll inside their own container is acceptable).
- Light and dark theme — confirm the new pipeline/chip/badge colors remain legible in both.

## Pass condition

No data mismatch between what quality approves and what stock shows, no role able to perform the other's action, no orphaned or duplicated stock quantity, no unauthenticated/unauthorized access to any new screen or endpoint, no console error on any of the above, no broken navigation link.
