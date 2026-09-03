# WMS — Master UAT Plan (v1.0)

A single acceptance checklist spanning every major workflow in the system —
web and mobile. Use this as the top-level plan; it points to the dedicated
checklists (`docs/ANDROID-UAT-V1.0.md`, `docs/SUBCONTRACTOR-MATERIALS-UAT-V1.0.md`)
for platform- or feature-specific detail rather than duplicating them.

Record **Actual result**, **Pass/Fail**, **Evidence** (screenshot/log ref) and
a **Defect ID** for every row. Seeded test users (password `Passw0rd!` unless
noted): `requester@example.com`, `manager@example.com`, `erp@example.com`,
`supervisor@example.com` (warehouse), `picker@example.com`,
`whoperator@example.com`, `quality@example.com`, `shipping@example.com`,
`admin@example.com`. Test against a fresh seeded database
(`node server/db/migrate.js && node server/db/seed.js`) unless a section says
otherwise.

**Build under test:** version ______ · commit ______ · environment (local /
staging / `wms.kynox.io`) ______
**Tester:** ______ · **Date:** ______

---

## A. Requests → Approval → ERP → Allocation → Picking → GI

| # | Area | Role | Preconditions | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Login | any | valid creds | Sign in | Home/dashboard loads; token stored | | | | |
| A2 | Permission-based nav | requester vs admin | signed in | Compare visible menu/tiles per role | Only permitted modules shown; admin sees all (`permissions_management`, `users_management`, `audit_trail`) | | | | |
| A3 | Create request | requester (`create_request`) | — | Create request with cost center, project/WBS, required date, priority, lines | Saved; all fields persisted | | | | |
| A4 | Requester details visible downstream | erp/supervisor/picker | A3 submitted | Open the request at ERP, allocation, picking, GI | Requester + dept/cost center/project/required date shown at every stage | | | | |
| A5 | Approval | manager (`approvals`) | A3 submitted | Approve | Moves to ERP queue | | | | |
| A6 | Value approval matrix | manager/admin | high-value request | Manager approves a high-value request | Blocked (needs high-value permission); admin can approve | | | | |
| A7 | Self-approval prevention | manager | manager is requester | Try to approve own request | Blocked | | | | |
| A8 | ERP reservation | erp (`erp_operator`) | approved | Enter reservation + movement type | Reserved; stock-reserved figure updates | | | | |
| A9 | Allocation (bin & batch assign) | supervisor (`bin_batch_assignment`) | reserved | Allocate | FIFO/FEFO bin+batch assigned | | | | |
| A10 | Picker assignment | supervisor (`picker_assignment`) | allocated | Assign picker | Task created; picker notified | | | | |
| A11 | QR/bin scan (picking) | picker (`picking`) | assigned | Scan bin then batch QR; scan a wrong bin | Correct passes; wrong bin rejected (`WRONG_BIN`) | | | | |
| A12 | Manual scan fallback / admin override | picker/admin | assigned | Picker cannot skip scan; admin skips | Picker 403; admin skip recorded in audit trail | | | | |
| A13 | Picking + GI | picker/whoperator (`gi_posting`) | scanned | Confirm picks → complete → post GI | Stock issued; status Pending ERP GI → GI posted | | | | |
| A14 | Partial completion | picker | short pick | Confirm less than reserved | Closed-with-shortage path correct | | | | |
| A15 | Reverse one step | stage owner | request at each stage | Reverse from Approval, ERP, Allocation, Picker-assignment, Picking (no picks yet) | Returns to previous queue; reservation/allocation/task released; blocked once any line is picked | | | | |
| A16 | GI reversal | whoperator | GI posted | Reverse GI | Stock returned; audit recorded | | | | |
| A17 | Cancellation | requester/admin | open request | Cancel | Reservations/allocations released | | | | |
| A18 | Duplicate-submit guard | requester | request form open | Double-click Submit rapidly | Exactly one request created, not two | | | | |

## B. Reallocation & stock movements

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| B1 | Reallocate part of a batch | `reallocation` | Move part of a batch to a new bin/warehouse | Split creates a new QR; source quantity reduced accordingly | | | | |
| B2 | Reallocate reserved stock | `reallocation` | Try to move quantity that is currently reserved | Blocked — reserved stock cannot be moved | | | | |
| B3 | Stock movement history | any with `stock_in`/`stock_out` | View a batch's movement history | All movements (receipt, issue, reallocation, adjustment) listed in order with reference | | | | |

## C. Goods receipt & quality

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| C1 | Goods receipt against PO | `goods_receipt` | Receive with a bin assignment | Batch + QR label generated; bin assigned; stock increases | | | | |
| C2 | Quality hold on receipt | `goods_receipt` | Receive with a quality hold flagged | Batch created on hold; unavailable for allocation until released | | | | |
| C3 | Quality inspection — release | `quality` | Batch on hold | Release | Batch becomes available; state recorded | | | | |
| C4 | Quality inspection — block/reject | `quality` | Batch on hold | Block, then reject | Correct terminal state each time; blocked batch stays unavailable, rejected batch removed from usable stock | | | | |

## D. Counting: cycle count & physical inventory

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| D1 | Cycle count with variance | `cycle_count` | Count a bin with a deliberate variance; post | Batch quantity adjusted to counted value; variance logged | | | | |
| D2 | Cycle count cannot post below reserved | `cycle_count` | Count below the reserved quantity for that batch | Blocked | | | | |
| D3 | Physical inventory — blind count | supervisor/admin | Start a count session | Counters do not see system quantity while counting | | | | |
| D4 | Recount & 4-eyes approval | supervisor/admin | Variance found | Recount available; own-variance approval by the same counter is blocked; a second approver can approve | | | | |
| D5 | Freeze & post | admin | Session ready to close | Warehouse freezes during posting; adjustments post atomically; warehouse unfreezes after | | | | |

## E. Shipping & delivery

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| E1 | Delivery order → dispatch | `shipping` | Create delivery order → pack → load → dispatch → deliver with POD | Each transition enforced in order; QR label produced; requester notified at dispatch/delivery | | | | |
| E2 | Carrier / ship-to capture | `shipping` | Create a delivery order | Ship-to, carrier, received-by fields persisted and shown on the record | | | | |

## F. Scan Bin (mobile)

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| F1 | Scan a bin label | any signed-in user | Home → Scan Bin → scan a bin's QR/barcode | Bin resolved; occupancy, materials, quantities, batch/lot and expiry shown; read-only (no stock change) | | | | |
| F2 | Manual bin-code entry | any signed-in user | Scan Bin → type a known bin code → Go | Same result as scanning | | | | |
| F3 | Unknown / invalid code | any signed-in user | Enter a code that doesn't exist | Clear "could not look up this bin" error, no crash | | | | |
| F4 | Empty bin | any signed-in user | Scan/enter a bin with no stock | Shown as Empty, no materials/batches listed | | | | |
| F5 | Shortcut from Bin Locations | any signed-in user | Bin Locations screen → tap scan icon in app bar | Opens Scan Bin directly | | | | |
| F6 | Restriction flags | any signed-in user | Scan a bin flagged hazard/temperature-controlled/quality-restricted | All applicable flags shown | | | | |

## G. Subcontractor materials

See `docs/SUBCONTRACTOR-MATERIALS-UAT-V1.0.md` for the full scripted scenarios
(logging deliveries, role separation, quality decisions posting directly to
stock, partial approval, all-lines-rejected, guardrails). Confirm on each
release:

| # | Area | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|
| G1 | Full scenario re-run | All scenarios in the dedicated doc still pass | | | | |
| G2 | Module invisibility | A user without any `subcontractor_*` permission sees no trace of the module | | | | |

## H. Master data & admin

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| H1 | Materials master | `materials` | Create/edit a material | Saved; appears in pickers/lookups app-wide | | | | |
| H2 | Warehouses / site stores | `warehouses_master` | Create a warehouse; toggle active | Reflected in warehouse selectors; inactive warehouse excluded from new transactions | | | | |
| H3 | Bin locations master | `bins_master` | Create a bin location with capacity/hazard/temperature/quality flags | Saved; flags surface later in Bin Locations list and Scan Bin (see F6) | | | | |
| H4 | Users & permissions | `users_management`, `permissions_management` | Create a user; assign/revoke a permission | Access changes take effect on next login (or immediately, per session design) | | | | |
| H5 | Audit trail | `audit_trail` | Perform a sampling of actions above (approve, reverse, admin skip, quality decision) | Each appears in the audit trail with actor, timestamp, and action detail | | | | |
| H6 | Movement types master | `movement_types_master` | Add/edit a movement type | Available in ERP reservation and stock-movement pickers | | | | |
| H7 | Mass import | admin/import permission | Import materials or opening stock via the bulk import screen | Valid rows imported; invalid rows rejected with row-level errors, no partial silent corruption | | | | |
| H8 | Opening stock reconciliation | admin | Run reconciliation dry-run, review, then apply | Dry-run output reviewed before apply; apply only on explicit confirmation (per CLAUDE.md safety invariants) | | | | |
| H9 | Export | any with export access | Export a report/list | File downloads with correct filtered data | | | | |

## I. Dashboards, KPIs & AI analytics

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| I1 | Dashboard drill-through | `dashboard` | Tap a KPI / top material / recent movement | Navigates to the relevant filtered screen | | | | |
| I2 | KPI dashboard | `kpi_dashboard` | Open KPI dashboard | Figures match underlying data for the same period | | | | |
| I3 | AI Stock Analytics | `ai_analytics` | Open analytics screen | Insights/forecasts render without error; no fabricated data on an empty dataset | | | | |
| I4 | Analytical attestations | `analytical_attestation_submit` / `_approve` | Submit an attestation, then approve as a separate user | Submitter cannot self-approve; approved attestation recorded | | | | |

## J. Notifications

See `docs/ANDROID-UAT-V1.0.md` §C for the full push-notification device matrix
(foreground/background/terminated/locked, tap routing, token refresh, no
duplicates). Confirm in-app:

| # | Area | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|
| J1 | In-app notification list | Unread count badge matches list; opening an item marks it read | | | | |
| J2 | Notification-triggering events | Approval, GI reversal, delivery dispatch etc. each produce the expected notification to the right role | | | | |

## K. Cross-cutting UX, localization & resilience

| # | Area | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|
| K1 | Arabic RTL | Settings → Arabic | UI flips to RTL; all new-since-last-release strings translated (not falling back to English key) | | | | |
| K2 | French | Settings → French | All new-since-last-release strings translated | | | | |
| K3 | Dark mode | Settings → Dark | Dark theme applied app-wide, including newest screens | | | | |
| K4 | Back-button behavior (mobile) | On a deep screen, press Back repeatedly | Pops screens; does not instantly kill the app from Home (confirm-to-exit) | | | | |
| K5 | Offline / network loss | Enable airplane mode, use the app | Graceful error, no crash; recovers when back online | | | | |
| K6 | Session expiry | Let a token expire, then act | Redirected to login, no silent failure or stuck spinner | | | | |
| K7 | Double-submit guards | Rapidly double-click any Submit-type action app-wide | Exactly one record created (see A18 for the request case; spot-check at least one other form) | | | | |
| K8 | App lock (mobile) | Enable app lock in settings, background then foreground the app | Lock screen shown before content is visible | | | | |
| K9 | Change password | Settings → change password with a weak, then a valid, new password | Weak password rejected with a clear rule; valid password accepted and required on next login | | | | |

## Sign-off

- **UAT status:** ☐ Not started ☐ In progress ☐ Passed ☐ Passed with noted defects
- **Verification method:** ______ (device / browser / environment)
- **Open defects at sign-off:** ______
- **Decision:** ☐ Approved for release ☐ Blocked — see defects above
- **Approved by:** ______ · **Date:** ______
