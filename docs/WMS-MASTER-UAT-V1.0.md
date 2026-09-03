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

**Build under test:** `main` @ `1e98985` (PR #112 merge) · commit `1e98985948d181ad5ce22fbfbbed70480a5fdb3e` · environment: local sandbox container, fresh `migrate`+`seed` — **not** staging or `wms.kynox.io`
**Tester:** Claude (this session) — automated-suite evidence only; no manual UI/device walkthrough performed
**Date:** 2026-09-03

**Note on this pass:** this session ran `npm test` (24 suites, 616 assertions, 0 failures after removing a local `.env` that was masking two production-safety-guard tests — see below), `npm run test:smoke` (Playwright, 31/31 passed), and `npm run lint` (0 errors, 9 pre-existing warnings), all against a fresh local database — never against staging or production. Rows below are marked **Pass** only where a specific automated assertion covers that exact behavior; rows needing real browser/mobile-device interaction (localization, dark mode, offline, session expiry, app lock, most of Scan Bin's UI) are marked **Not verified this session** rather than guessed at. This is real regression coverage, not a substitute for a human walkthrough before sign-off.

**Environment artifact (not a code defect):** on the first run, with a local `.env` file present, two tests failed — `P0-4 production boot blocked without JWT_SECRET` and `server DOES seed when ALLOW_AUTO_SEED=1`. Root cause: `server/config.js` calls `dotenv.config()`, which re-loaded `JWT_SECRET`/`SKIP_AUTO_SEED` from the local `.env` file into subprocesses whose test harness had deliberately unset them, masking the very "absence" conditions those two tests check. Confirmed by removing `.env` and re-running: both passed, and the full suite went green (0 failures). No code was touched to fix this — it was purely a local-environment condition.

---

## A. Requests → Approval → ERP → Allocation → Picking → GI

| # | Area | Role | Preconditions | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Login | any | valid creds | Sign in | Home/dashboard loads; token stored | All 7 seeded roles logged in and received a token | Pass | `npm test` — idempotency_test.py: login/token pairs for all roles; `test:smoke` — "login form renders" / "authenticated view renders after login" | |
| A2 | Permission-based nav | requester vs admin | signed in | Compare visible menu/tiles per role | Only permitted modules shown; admin sees all | API-level permission enforcement + role-scoped nav confirmed | Pass | `npm test` — workflow_test.py: "requester blocked from approvals" / "picker blocked from ERP queue" / "requester blocked from GI queue"; `test:smoke` — "ERP Home defaults to a focused role-process catalog" / "Role presentation does not expose a destination that the ERP role lacks permission to access" | |
| A3 | Create request | requester (`create_request`) | — | Create request with cost center, project/WBS, required date, priority, lines | Saved; all fields persisted | Request created; all fields persisted and later confirmed visible downstream (see A4) | Pass | `npm test` — workflow_test.py: "S1 create request" / "S27 same request number across all lines" | |
| A4 | Requester details visible downstream | erp/supervisor/picker | A3 submitted | Open the request at ERP, allocation, picking, GI | Requester + dept/cost center/project/required date shown at every stage | Confirmed at all 4 stages | Pass | `npm test` — r3_test.py: "ERP queue shows department/project/cost center/required date" / "warehouse queue shows requester details" / "picking task list shows requester details" / "GI queue shows requester details" | |
| A5 | Approval | manager (`approvals`) | A3 submitted | Approve | Moves to ERP queue | Approved; another approver flow also confirmed | Pass | `npm test` — workflow_test.py: "S1 approve"; p1_regression_test.py: "P1-1 another approver can approve" | |
| A6 | Value approval matrix | manager/admin | high-value request | Manager approves a high-value request | Blocked (needs high-value permission); admin can approve | Confirmed both directions + low-value manager path | Pass | `npm test` — p2_test.py: "high-value blocked for manager (403)" / "high-value approved by admin" / "low-value approved by manager" | |
| A7 | Self-approval prevention | manager | manager is requester | Try to approve own request | Blocked | Non-admin self-approval blocked; admin exempt as designed | Pass | `npm test` — p1_regression_test.py: "P1-1 non-admin self-approval blocked (403)" | |
| A8 | ERP reservation | erp (`erp_operator`) | approved | Enter reservation + movement type | Reserved; stock-reserved figure updates | Confirmed, plus missing-movement-type guard | Pass | `npm test` — workflow_test.py: "S1 erp details saved" / "S6 blocked without movement type" | |
| A9 | Allocation (bin & batch assign) | supervisor (`bin_batch_assignment`) | reserved | Allocate | FIFO/FEFO bin+batch assigned | FIFO and FEFO both confirmed; invalid-bin rejection confirmed | Pass | `npm test` — workflow_test.py: "S1 allocate FIFO" / "S9 FIFO splits across batches" / "S10 FEFO nearest expiry first"; refinements_test.py: "picker assigns bin from dropdown" / "invalid bin rejected" | |
| A10 | Picker assignment | supervisor (`picker_assignment`) | allocated | Assign picker | Task created; picker notified | Task creation confirmed directly | Pass (partial) | `npm test` — workflow_test.py: "S1 assign picker"; idempotency_test.py: "first picker assignment" / "first assignment returned task id" — *picker-notification delivery itself not independently asserted this session* | |
| A11 | QR/bin scan (picking) | picker (`picking`) | assigned | Scan bin then batch QR; scan a wrong bin | Correct passes; wrong bin rejected (`WRONG_BIN`) | Confirmed both outcomes | Pass | `npm test` — uat_test.py: "scanning a DIFFERENT bin fails (WRONG_BIN)" / "scanning the correct bin location passes"; workflow_test.py: "S11 wrong QR blocked" | |
| A12 | Manual scan fallback / admin override | picker/admin | assigned | Picker cannot skip scan; admin skips | Picker 403; admin skip recorded in audit trail | Confirmed | Pass | `npm test` — uat_test.py: "picker cannot skip scan (403)" / "admin skip-scan works" / "skip recorded in audit trail" | |
| A13 | Picking + GI | picker/whoperator (`gi_posting`) | scanned | Confirm picks → complete → post GI | Stock issued; status Pending ERP GI → GI posted | Confirmed end to end, including idempotent replay | Pass | `npm test` — workflow_test.py: "S1 confirm line" / "S1 complete picking" / "S1 GI posted -> Completed"; idempotency_test.py picking/GI chain | |
| A14 | Partial completion | picker | short pick | Confirm less than reserved | Closed-with-shortage path correct | Confirmed | Pass | `npm test` — workflow_test.py: "S14 partial pick needs shortage reason" / "S14 partial pick with reason" / "S20 complete partial picking" / "S20 GI -> Partially Completed" | |
| A15 | Reverse one step | stage owner | request at each stage | Reverse from Approval, ERP, Allocation, Picker-assignment, Picking (no picks yet) | Returns to previous queue; reservation/allocation/task released; blocked once any line is picked | All 5 stages confirmed, plus the picked-line block | Pass | `npm test` — reverse_workflow_test.py: "approval stage reverses to Draft" / "ERP stage reverses to Pending Manager Approval" / "ERP reservation cleared on reverse" / "allocation reverses to Pending Bin Location Assignment" / "pre-allocate stage reverses to ERP Operator queue" / "picking stage (no picks) reverses to Pending Picker Assignment" / "reverse blocked once lines are picked (400)" | |
| A16 | GI reversal | whoperator | GI posted | Reverse GI | Stock returned; audit recorded | Confirmed, including double-reverse and no-reason rejection | Pass | `npm test` — reverse_workflow_test.py: "GI stage reverses to Picking in Progress" / "GI return-to-picker preserves ERP execution context"; p2_test.py: "reverse succeeds" / "reversal returns 30 units to stock" / "double reverse rejected (400)" / "reverse without reason rejected (400)" | |
| A17 | Cancellation | requester/admin | open request | Cancel | Reservations/allocations released | Confirmed | Pass | `npm test` — p0_regression_test.py: "P0-2 cancel succeeded" / "P0-2 cancel released reservations" | |
| A18 | Duplicate-submit guard | requester | request form open | Double-click Submit rapidly | Exactly one request created, not two | Server-side idempotency-key replay confirmed to return the original, not a duplicate | Pass (server-side) | `npm test` — idempotency_test.py: "first create request (with idempotency_key)" / "replay create request (same idempotency_key)" / "create-request replay returns the same request, not a new one" — *this proves the #108 fix's server mechanism; the literal browser double-click / button-lockout behavior needs a browser and was not exercised this session* | |

## B. Reallocation & stock movements

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| B1 | Reallocate part of a batch | `reallocation` | Move part of a batch to a new bin/warehouse | Split creates a new QR; source quantity reduced accordingly | Confirmed, including SoD (requester can't approve own reallocation) and idempotent replay | Pass | `npm test` — r3_test.py: "partial reallocation submitted for approval" / "requester cannot approve own reallocation (SoD)" / "approved partial reallocation executes and splits batch" / "source batch reduced to 6" / "split batch holds 4 in WH02 with bin + project" / "reallocation history recorded" | |
| B2 | Reallocate reserved stock | `reallocation` | Try to move quantity that is currently reserved | Blocked — reserved stock cannot be moved | Movable-quantity guard confirmed | Pass | `npm test` — r3_test.py: "reallocation of more than movable rejected (400)" | |
| B3 | Stock movement history | any with `stock_in`/`stock_out` | View a batch's movement history | All movements (receipt, issue, reallocation, adjustment) listed in order with reference | — | Not verified this session | No automated assertion found covering this specific view; recommend a manual check | |

## C. Goods receipt & quality

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| C1 | Goods receipt against PO | `goods_receipt` | Receive with a bin assignment | Batch + QR label generated; bin assigned; stock increases | Confirmed | Pass | `npm test` — refinements_test.py: "receiving auto-generates batch" / "receiving QR has no bin yet" → "picker assigns bin from dropdown" / "QR label synced with GR + bin"; uat_test.py: "receive with bin location" | |
| C2 | Quality hold on receipt | `goods_receipt` | Receive with a quality hold flagged | Batch created on hold; unavailable for allocation until released | Confirmed | Pass | `npm test` — features_test.py: "Quality: receipt lands on QUALITY_HOLD" / "Quality: batch in pending-inspection queue" | |
| C3 | Quality inspection — release | `quality` | Batch on hold | Release | Batch becomes available; state recorded | Confirmed, plus notification on inspection | Pass | `npm test` — features_test.py: "Quality: quality user releases batch" / "Quality: leaves pending queue after release" / "Quality: inspection notification sent" | |
| C4 | Quality inspection — block/reject | `quality` | Batch on hold | Block, then reject | Correct terminal state each time; blocked batch stays unavailable, rejected batch removed from usable stock | Block confirmed; explicit Reject transition not separately asserted this session | Partial | `npm test` — workflow_test.py: "S13 quality can block batch" | Recommend explicit reject-path assertion |

## D. Counting: cycle count & physical inventory

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| D1 | Cycle count with variance | `cycle_count` | Count a bin with a deliberate variance; post | Batch quantity adjusted to counted value; variance logged | Confirmed | Pass | `npm test` — p3_test.py: "cycle count opened" / "cycle count variance computed" / "cycle count posted" / "batch stock adjusted by variance" | |
| D2 | Cycle count cannot post below reserved | `cycle_count` | Count below the reserved quantity for that batch | Blocked | Confirmed, plus at/above-reserved success path | Pass | `npm test` — uat2_test.py: "post below reserved is blocked (400)" / "post at/above reserved succeeds" | |
| D3 | Physical inventory — blind count | supervisor/admin | Start a count session | Counters do not see system quantity while counting | Confirmed, plus admin's contrasting visibility | Pass | `npm test` — r3_test.py: "blind session hides system quantities from counters" / "admin sees system quantities" | |
| D4 | Recount & 4-eyes approval | supervisor/admin | Variance found | Recount available; own-variance approval by the same counter is blocked; a second approver can approve | Four-eyes rule confirmed; a distinct "recount" action was not independently asserted | Pass (partial) | `npm test` — r3_test.py: "own variance approval blocked (four-eyes, 403)" / "variance approved by second person" | |
| D5 | Freeze & post | admin | Session ready to close | Warehouse freezes during posting; adjustments post atomically; warehouse unfreezes after | Confirmed, including a receipt correctly blocked mid-freeze | Pass | `npm test` — r3_test.py: "annual inventory session opened" / "freeze blocks goods receipt into counted warehouse (400)" / "inventory session posted with adjustments" / "warehouse unfrozen after posting" | |

## E. Shipping & delivery

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| E1 | Delivery order → dispatch | `shipping` | Create delivery order → pack → load → dispatch → deliver with POD | Each transition enforced in order; QR label produced; requester notified at dispatch/delivery | Full chain confirmed end to end, including out-of-order transitions correctly rejected and duplicate-shipment guard | Pass | `npm test` — r3_test.py: "GI-posted request is shipping-eligible" → "shipment created with QR value" → "duplicate shipment for the same request rejected (409)" → "dispatch before pack rejected (400)" → "shipment pack ok" → "shipment load ok" → "shipment dispatch ok" → "delivery confirmed with POD" → "shipment shows POD + issued lines" → "shipment QR label PDF renders" → "requester notified of delivery" | |
| E2 | Carrier / ship-to capture | `shipping` | Create a delivery order | Ship-to, carrier, received-by fields persisted and shown on the record | Record shown with POD + issued lines confirmed; carrier/ship-to field display not separately asserted by name | Partial | `npm test` — r3_test.py: "shipment shows POD + issued lines" | Recommend a field-level assertion for carrier/ship-to/received-by |

## F. Scan Bin (mobile)

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| F1 | Scan a bin label | any signed-in user | Home → Scan Bin → scan a bin's QR/barcode | Bin resolved; occupancy, materials, quantities, batch/lot and expiry shown; read-only (no stock change) | The backing API (`GET /api/dashboard/bins/lookup`) confirmed to resolve occupancy/materials/quantity correctly; Flutter screen itself not exercised (no mobile device/emulator in this environment) | Pass (API only) | `npm test` — import_test.py: "bin lookup by full_bin_location returns 200" / "bin lookup resolves the expected bin" / "bin lookup reports occupied with materials" / "bin lookup quantity matches bin overview" | |
| F2 | Manual bin-code entry | any signed-in user | Scan Bin → type a known bin code → Go | Same result as scanning | Same endpoint confirmed to resolve by bare bin_code + warehouse | Pass (API only) | `npm test` — import_test.py: "bin lookup by bare bin_code + warehouse also resolves" | |
| F3 | Unknown / invalid code | any signed-in user | Enter a code that doesn't exist | Clear "could not look up this bin" error, no crash | API returns 404 for unknown code, 400 for no code; app-side error message not verified | Pass (API only) | `npm test` — import_test.py: "bin lookup 404s for an unknown code" / "bin lookup 400s with no code" | |
| F4 | Empty bin | any signed-in user | Scan/enter a bin with no stock | Shown as Empty, no materials/batches listed | — | Not verified this session | Needs a device/emulator | |
| F5 | Shortcut from Bin Locations | any signed-in user | Bin Locations screen → tap scan icon in app bar | Opens Scan Bin directly | — | Not verified this session | Needs a device/emulator | |
| F6 | Restriction flags | any signed-in user | Scan a bin flagged hazard/temperature-controlled/quality-restricted | All applicable flags shown | — | Not verified this session | Needs a device/emulator | |

## G. Subcontractor materials

See `docs/SUBCONTRACTOR-MATERIALS-UAT-V1.0.md` for the full scripted scenarios
(logging deliveries, role separation, quality decisions posting directly to
stock, partial approval, all-lines-rejected, guardrails). Confirm on each
release:

| # | Area | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|
| G1 | Full scenario re-run | All scenarios in the dedicated doc still pass | Core chain (create subcontractor → delivery → quality approval auto-receives to stock → consumption, all idempotent) smoke-checked; the dedicated doc's full scripted scenarios (role separation, partial approval, all-lines-rejected) were **not** independently re-run this session | Pass (core chain only) | `npm test` — idempotency_test.py: "create subcontractor" → "first subcontractor delivery" → "approve delivery line quality (auto-receives into stock)" → "first subcontractor consumption" (all with idempotent-replay checks) | Recommend running `docs/SUBCONTRACTOR-MATERIALS-UAT-V1.0.md` directly before sign-off |
| G2 | Module invisibility | A user without any `subcontractor_*` permission sees no trace of the module | — | Not verified this session | | |

## H. Master data & admin

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| H1 | Materials master | `materials` | Create/edit a material | Saved; appears in pickers/lookups app-wide | Create/update/delete all confirmed, each audited | Pass | `npm test` — p1_regression_test.py: "P5-1 material create succeeds" / "material create is audited" / "material update succeeds" / "material update is audited" / "material delete succeeds" / "material delete is audited" | |
| H2 | Warehouses / site stores | `warehouses_master` | Create a warehouse; toggle active | Reflected in warehouse selectors; inactive warehouse excluded from new transactions | Creation confirmed; active-toggle exclusion behavior not independently asserted this session | Pass (partial) | `npm test` — import_test.py: "warehouses created" | |
| H3 | Bin locations master | `bins_master` | Create a bin location with capacity/hazard/temperature/quality flags | Saved; flags surface later in Bin Locations list and Scan Bin (see F6) | Creation + warehouse validation confirmed; flag round-trip not independently asserted this session | Pass (partial) | `npm test` — import_test.py: "bins import validates warehouse" | |
| H4 | Users & permissions | `users_management`, `permissions_management` | Create a user; assign/revoke a permission | Access changes take effect on next login (or immediately, per session design) | Account creation/listing confirmed; permission assign/revoke endpoint not independently exercised this session | Pass (partial) | `npm test` — p1_hardening_test.py: "signup creates account (async hash)" / "duplicate signup rejected (409)" / "new user is listed" | |
| H5 | Audit trail | `audit_trail` | Perform a sampling of actions above (approve, reverse, admin skip, quality decision) | Each appears in the audit trail with actor, timestamp, and action detail | Confirmed extensively, plus the audit trail's own tamper-resistance | Pass | `npm test` — password_test.py: "admin reset is audited" / "self change is audited" / "audit trail does not contain 'Interim777'" (no plaintext secrets); p1_hardening_test.py: "UPDATE on audit_trail is blocked" / "DELETE on audit_trail is blocked"; reports_test.py: facets/filters | |
| H6 | Movement types master | `movement_types_master` | Add/edit a movement type | Available in ERP reservation and stock-movement pickers | — | Not verified this session | Only usage of existing movement types was exercised (e.g. "S6 blocked without movement type"), not master CRUD | |
| H7 | Mass import | admin/import permission | Import materials or opening stock via the bulk import screen | Valid rows imported; invalid rows rejected with row-level errors, no partial silent corruption | Extensively confirmed, including rollback-on-failure and per-row error isolation | Pass | `npm test` — import_test.py (49/49): "materials import preserves row errors" / "invalid rows preserved while valid row commits" / "unknown material/warehouse/bin error" / "rollback removes batch/stock-balance/transaction write"; features_test.py: "Bulk materials: 2 created, 1 skipped, 1 error" | |
| H8 | Opening stock reconciliation | admin | Run reconciliation dry-run, review, then apply | Dry-run output reviewed before apply; apply only on explicit confirmation (per CLAUDE.md safety invariants) | Dry-run-by-default and scoped-reconciliation safety behavior confirmed in code; **no apply was run** — this remains a separate, explicitly gated action per `CLAUDE.md` and `docs/WMS-CURRENT-STATUS.md` item 7, unrelated to this release | Pass (safety behavior only) | `npm test` — import_test.py: "date reconciliation defaults to dry run" / "ordinary GR batches are excluded from reconciliation" / "scoped reconciliation applies" | |
| H9 | Export | any with export access | Export a report/list | File downloads with correct filtered data | Confirmed for the audit/PDF export path | Pass | `npm test` — reports_test.py: "pdf export returns application/pdf" / "pdf body starts with %PDF" / "pdf has content-disposition attachment" / "pdf export rejects no columns" / "pdf export requires auth" | |

## I. Dashboards, KPIs & AI analytics

| # | Area | Role | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|
| I1 | Dashboard drill-through | `dashboard` | Tap a KPI / top material / recent movement | Navigates to the relevant filtered screen | — | Not verified this session | UI navigation behavior — needs a browser | |
| I2 | KPI dashboard | `kpi_dashboard` | Open KPI dashboard | Figures match underlying data for the same period | Confirmed | Pass | `npm test` — workflow_test.py: "KPI dashboard returns metrics"; p1_regression_test.py: "P1-2 dashboard total_stock from batches (> 0)" / "P1-2 dashboard reports bin locations" | |
| I3 | AI Stock Analytics | `ai_analytics` | Open analytics screen | Insights/forecasts render without error; no fabricated data on an empty dataset | Extensively confirmed, including the no-fabrication guarantee on sparse/absent movement history | Pass | `npm test` — features_test.py (AI: 8 checks incl. "requester blocked (permission)"); r3_test.py: "analytics has ABC/XYZ/FSN classes" / "ABC-XYZ matrix (9 cells)"; corrective_integrity_test.py: "no movement evidence reports NONE coverage" / "stocked materials are UNKNOWN, never DEAD, with no history" / "coverage warning states absence is not proof" | |
| I4 | Analytical attestations | `analytical_attestation_submit` / `_approve` | Submit an attestation, then approve as a separate user | Submitter cannot self-approve; approved attestation recorded | Confirmed, including the 5-business-day cutoff and supersession rules | Pass | `npm test` — corrective_integrity_test.py: "same user submit and approve is rejected" / "separate internal data steward approves after five-business-day cut-off" / "replacement attestation is separately approved and supersedes prior evidence" | |

## J. Notifications

See `docs/ANDROID-UAT-V1.0.md` §C for the full push-notification device matrix
(foreground/background/terminated/locked, tap routing, token refresh, no
duplicates). Confirm in-app:

| # | Area | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|
| J1 | In-app notification list | Unread count badge matches list; opening an item marks it read | Unread-count endpoint confirmed; "mark read on open" not independently asserted this session | Pass (partial) | `npm test` — r3_test.py: "unread-count endpoint works" | |
| J2 | Notification-triggering events | Approval, GI reversal, delivery dispatch etc. each produce the expected notification to the right role | Confirmed for quality inspection, email-channel, and delivery events | Pass | `npm test` — features_test.py: "Quality: inspection notification sent"; p2_test.py: "email-channel notifications recorded"; r3_test.py: "requester notified of delivery" | |

## K. Cross-cutting UX, localization & resilience

| # | Area | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|
| K1 | Arabic RTL | Settings → Arabic | UI flips to RTL; all new-since-last-release strings translated (not falling back to English key) | — | Not verified this session | Needs a browser/device | |
| K2 | French | Settings → French | All new-since-last-release strings translated | — | Not verified this session | Needs a browser/device | |
| K3 | Dark mode | Settings → Dark | Dark theme applied app-wide, including newest screens | — | Not verified this session | Needs a browser/device | |
| K4 | Back-button behavior (mobile) | On a deep screen, press Back repeatedly | Pops screens; does not instantly kill the app from Home (confirm-to-exit) | — | Not verified this session | Needs a mobile device/emulator | |
| K5 | Offline / network loss | Enable airplane mode, use the app | Graceful error, no crash; recovers when back online | — | Not verified this session | Needs a mobile device/emulator | |
| K6 | Session expiry | Let a token expire, then act | Redirected to login, no silent failure or stuck spinner | — | Not verified this session | Needs a browser | |
| K7 | Double-submit guards | Rapidly double-click any Submit-type action app-wide | Exactly one record created (see A18 for the request case; spot-check at least one other form) | Server-side idempotent replay confirmed for goods receipt and subcontractor delivery/consumption, in addition to the request case (A18) | Pass (server-side) | `npm test` — idempotency_test.py: "goods receipt replay returns the same batch, not a new one" / "subcontractor delivery replay returns the same delivery, not a new one" / "subcontractor consumption replay returns the same record, not a new one" — *UI-level button-lockout (`UI.withBusy`) not exercised this session (needs a browser)* | |
| K8 | App lock (mobile) | Enable app lock in settings, background then foreground the app | Lock screen shown before content is visible | — | Not verified this session | Needs a mobile device/emulator | |
| K9 | Change password | Settings → change password with a weak, then a valid, new password | Weak password rejected with a clear rule; valid password accepted and required on next login | Confirmed, including forced-change-flag lifecycle and that no plaintext/hash ever reaches the audit trail | Pass | `npm test` — password_test.py: "self change rejects short new password" / "self change succeeds" / "old password no longer works" / "new password works" / "admin reset forces a password change" / "audit trail does not contain '\$2a\$'" | |

## Sign-off

- **UAT status:** ☐ Not started ☑ In progress ☐ Passed ☐ Passed with noted defects
- **Verification method:** Automated regression only this pass (`npm test` — 24 suites / 616 assertions / 0 failures; `npm run test:smoke` — 31/31; `npm run lint` — 0 errors), run against a local sandbox with a fresh seeded database. **No browser or mobile-device walkthrough was performed.**
- **Open defects at sign-off:** None found in automated coverage. Coverage gaps (not defects) remain in: B3, most of F (Scan Bin UI), G1's full scripted scenarios, I1, all of K1–K6/K8, and the partial rows noted above (A10, A18's UI half, C4's reject path, D4's recount action, E2's field-level check, H2–H4/H6, J1, K7's UI half).
- **Decision:** ☐ Approved for release ☑ Not yet — recommend closing the coverage gaps above (primarily: a real browser pass over localization/dark-mode/session-expiry, and a mobile-device pass over Scan Bin and app-lock/offline behavior) before sign-off
- **Approved by:** ______ · **Date:** ______
