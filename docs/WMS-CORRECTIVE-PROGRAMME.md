# WMS Corrective Programme

**Status:** draft v0.9 — three audit domains still outstanding (see §0.2).
**Baseline:** `main` at `40e68bc`. Production at `76a1420` (7 commits behind, 2 migrations unapplied).
**Purpose:** one complete corrective pass. Written so that it does not need a further audit round.

This document is the plan of record. It supersedes nothing; it collects the findings of
nine agent reviews, each item independently re-verified in code, into an executable order.

---

## 0. How to read this

### 0.1 Evidence labels
Every item carries one:
- **VERIFIED** — re-read in code at the stated file:line by the orchestrator, not only by an agent.
- **REPORTED** — an agent's finding, plausible, not independently re-read.
- **DEVICE** — cannot be settled without a physical device or a deployed tenant.

### 0.2 Known gaps in this draft
Three audits did not complete (session rate limit). Until they run, this plan is not final:

| Domain | What is missing | Risk of proceeding without it |
| --- | --- | --- |
| Security | Full-product pass: auth, session, tenancy isolation, import paths, CI secrets. Also the challenge to PR 7 (does `site_storekeeper` collapse a control that exists for a reason?) and to PR 13's client-side checklist filter (is it hiding a server-side authorization gap?). | PR 7 changes an authorization boundary. Do not merge it before the security challenge is answered. |
| Data truth | Whether `analytics_truth_test.py` would catch A2/A10/A11, and whether multiplying stock by `materials.price` is correct given how price is populated — or just moves the lie. | PR 8 and the spend report both depend on this. |
| Performance | Index requirements for the spend-by-project report; the unpaginated `/api/dashboard/bins`. | Only affects Wave 6. Safe to sequence last. |

**Rule: PR 7 and PR 8 do not merge until the security and data-truth passes have run.**
Everything in Waves 0–2 is independent of all three gaps and can proceed now.

---

## 1. The finding that reorders everything

The product cannot be piloted in a browser today. On a contracting tenant, an approved
request reaches `Pending Picker Assignment` with stock reserved against it and **cannot be
advanced from any screen**:

- `POST /api/picking/requests/:id/claim` (`server/routes/picking.js:75`) is the only forward
  edge. `grep -rn "claim" public/js` returns two prose matches and **zero API calls**. — VERIFIED
- The fallback, Picker Assignment, populates its dropdown with
  `WHERE r.name='picker'` (`server/routes/warehouse.js:146`), so a storekeeper on any other
  role — and the administrator, the only user a provisioned tenant has — is not selectable. — VERIFIED
- `tests/smoke/first_run_guide_browser.js:154` drives the claim **over the API with a bearer
  token**, then asserts only that the page *text* mentions claiming. The test passes on a dead
  screen. — VERIFIED

Everything else in this programme is secondary to that.

---

## 2. Register of findings

Grouped by the wave that fixes them. `A/B/C/D` ids match the working brief; `O` = ops.

### Engine and workflow
| id | finding | evidence |
| --- | --- | --- |
| A1 | No client for the claim endpoint; Picker Assignment excludes every eligible user | VERIFIED |
| A2 | `server/services/allocation.js` has no `owner_type` predicate — a released SUBCONTRACTOR batch is allocatable to a company request, while the reporting layer excludes it. Engine and reports contradict. No test covers it. | VERIFIED |
| A3 | `activeFreeze` is enforced in `receiving`/`warehouse`/`reallocation`/`subcontractors` and **not** in `picking.js` or `gi.js`. Stock is issuable during a frozen count; `inventory.js:228-236` then resets `remaining_quantity` from a stale snapshot and writes a contradictory adjustment. | VERIFIED |
| A4 | No seeded role can run the collapsed workflow. `warehouse_operator` holds `gi_posting` but not `picking`/`goods_receipt`/`quality`. `warehouses_master` is granted to **no role at all**. | VERIFIED |
| A5 | `reservation_number` is documented as required for OUT (`migrate.js:110`); `ledger.js:60-78` accepts null and four OUT paths write null (`subcontractors.js:673`, `cycleCount.js:109`, `inventory.js:236`, `reallocation.js:277`). | REPORTED |
| A6 | No RETURN path for company material. `ledger.js:12` declares the category; nothing writes it. | REPORTED |
| A7 | `inventory.js:76-78` builds count sheets per **batch**, with no owner filter and no quality filter — a subcontractor's steel is counted as company property at period close. | REPORTED |
| A8 | `install-starter-data.js` never sets `is_batch_managed`/`is_expiry_managed`, contradicting its own comment. Consequence: FIFO always, no expiry alerts, and no QR-scan enforcement (`picking.js:281-286` is gated on those flags). | REPORTED |
| A9 | Three parallel stock ledgers. `converge-subcontractor-ledger.js` can never finish while the UI still writes to the legacy stream. | REPORTED |
| A10 | Opening stock double-counted on the Materials master. **Not a data problem** — `materials.js` search uses `COALESCE(batches, mls, 0)` while the list endpoint uses `batches + mls`. One query, one file. | VERIFIED |
| A11 | Request-screen availability has no quality, owner or block filter — the engineer sees stock that allocation will refuse. | VERIFIED |

### UI
| id | finding | evidence |
| --- | --- | --- |
| B1 | `kynox-v2.css` defines `:root` as the **dark** palette; `[data-theme="light"]` overrides 12 tokens and **none** of `--success`/`--danger`/`--warning`/`--role`. Default theme is light. `.badge.role` measures 1.28:1. | VERIFIED |
| B2 | `.btn:not(.secondary):not(.danger):not(.ghost)` outranks `.btn.success`, so green never renders. `.btn.warn` has **no rule anywhere** — "Reverse GI" is pixel-identical to "Submit". | VERIFIED |
| B3 | Dashboard renders "LIVE OPERATIONS" and a green "Data loaded" unconditionally; `renderCharts` has no empty guard — four blank canvases on a fresh tenant. | VERIFIED |
| B4 | First-run checklist links are rendered with no permission filter; `app.js:319-323` silently redirects. A user on `picker` bounces on all seven steps. | VERIFIED |
| B5 | `giPosting.js:56` ships "Simulate ERP posting error (test)" directly above the Post button. | VERIFIED |
| B6 | `approvals.js:172` collects `approvedLineIds` **only** when `decision === 'partial'`. Unticking lines and pressing "Approve" silently approves everything. Approval-integrity defect. | VERIFIED |
| B7 | `adminViews.js:141` links to `#/request-detail-lookup` — not a route; one occurrence in the repo. | VERIFIED |
| B8 | `warehouseData.js:156-164` posts a quality change on `change` with a hardcoded reason and no confirmation. A mouse-wheel over the select mutates stock state. | VERIFIED |
| B9 | `receiving.js:290` renders a CSS gradient, not a QR code. The PDF path is real. | REPORTED |
| B10 | `navigation-v2.js` group labels are a fourth name table; five of nine disagree with `app.js` MODULES and five routes are filed under different parents, so the breadcrumb contradicts the sidebar. | REPORTED |
| B11 | `tenantProfile.js` `terminology{}` and `requiredRequestFields[]` are both dead configuration — zero readers. Raw enums shown to users; `requestDetail.js` shows 14 fields of which 7 are always "—"; `ui.js:427` hardcodes an "ERP Processed" stage that cannot occur; the status filter offers 35 options, 8 unreachable. | VERIFIED (dead config), REPORTED (the rest) |
| B12 | Near-duplicate screens: Storage Locations (legacy) / Bin Locations / Stock by Location / Empty Locations — the last is one filter option of the third. Also Physical Inventory / Cycle Counting, and Subcontractor Stock / Subcontractor-Owned Stock. | REPORTED |
| B13 | Three different names for the user's own role on one screen; `ROLE_PROFILES` covers 4 of 9 seeded roles, the rest get a chip reading "Workspace". | REPORTED |
| B14 | `movementHistory.js` monkey-patches `Pages.importCenter.render` to bolt a JSON field-mapping panel onto the Import screen. | REPORTED |
| B15 | Dead code: unreachable `renderNoAccess()`, `qrHint()` returning `''` under a misleading comment, `stock-in`/`stock-out` routes in no menu. | REPORTED |
| B16 | Three tables have no empty state at all; `UI.meaningfulEmptyState` stamps a green success tick on "No stock recorded yet". | REPORTED |
| B17 | Table sorting is click-only on bare `<th>`; no focus management or live region on route change; unlabelled selects. | REPORTED |

### Mobile — last touched 2026-09-03; 62 commits on main since, 15 in `server/` or `public/`
| id | finding | evidence |
| --- | --- | --- |
| C1 | `gi_screen.dart:18` pre-fills a fabricated 10-digit GI number, so the server's number-minting branch (`gi.js:131-139`) is never reached from a phone. | VERIFIED |
| C2 | `android/app/build.gradle.kts:32-36` signs the **release** build with the debug key. Consecutive CI builds carry different keys; every update fails to install over the last, and the uninstall discards any unsynced offline queue. | VERIFIED |
| C3 | `scan_screen.dart:24` constructs `MobileScannerController` and never calls `.start()`. If correct, the camera never opens. | DEVICE |
| C4 | Mobile receiving sends no `owner_type`, so subcontractor material is booked as company stock — and ownership is immutable by design (`receiving.js:50-53`). | VERIFIED |
| C5 | `session.dart` `signOut()` does not clear `queue`; offline writes flush under the next user's token. | VERIFIED |
| C6 | `can()` checks admin **before** any edition gate; `session.dart:113` discards the `tenant` object entirely. | VERIFIED |
| C7 | `home_screen.dart` is a fifth name table: 10 screen names and 3 section names disagree with the web, four of them names the naming test pins as settled. `screen_naming_test.js` never opens a `.dart` file. | REPORTED |
| C8 | `pubspec.lock` stale since 2026-07-27 and pins none of `mobile_scanner`, `firebase_*`, `connectivity_plus`. Two builds of one commit can ship different camera and push plugins. | REPORTED |
| C9 | Arabic and French still offered in settings while the web settled English-only. Selecting Arabic flips the app to RTL and leaves most of it in English. | REPORTED |
| C10 | `docs/ANDROID-UAT-V1.0.md`: the steps are written; the **result** columns and the version/SHA/commit header are blank. The plan has never been run. Its header also instructs running against production, while its own steps include GI reversal and cycle count — a documented procedure for a debug-signed APK to mutate production stock. | REPORTED |

### Ops
| id | finding | evidence |
| --- | --- | --- |
| O1 | `tests/run.sh:16` is `rm -f data/wms.db data/wms.db-shm data/wms.db-wal` with **no** `DB_PATH`, `NODE_ENV` or path guard. Inside the production container that path is the bind-mounted production database — the three exact files of INC-2026-07-25-01. `CLAUDE.md` forbids this by prose and by nothing else. | VERIFIED |
| O2 | `scripts/fresh-start.js` guards only on `--yes`. No `NODE_ENV` check, no path refusal — unlike `reset-admin.js`, which has both. | VERIFIED |
| O3 | Production is 7 commits behind with migrations 026 and 027 unapplied; 027 **writes rows**. The pipeline refuses any `release_ref` that is not the tip of main, so the first corrective deploy would carry all of it at once. | VERIFIED |
| O4 | `/healthz` returns `{status:'ok'}` with no build marker. A 200 from the old container satisfies the deploy gate exactly as well as a 200 from the new one. | VERIFIED |
| O5 | `public/index.html` pins `kynox-v2.css`, `requests.js` and `requestDetail.js` to `/release-assets/9d79a00/`, frozen since 2026-08-18. **These are the files Wave 4 must change.** A correct CSS fix would reach no browser. | VERIFIED |
| O6 | The deploy gate watches `users`, `materials`, `batches`, `requests` — and none of `roles`, `role_permissions`, `material_location_stock`. Three of four planned data changes are invisible to it; the fourth (`batches`) would trip it and trigger an automatic **code** rollback while leaving the new rows written. | VERIFIED |
| O7 | `seed2.js:170` runs `UPDATE materials SET is_batch_managed=1` with **no WHERE clause**, and re-inserts every default grant for all nine roles. Re-running the seed on a live tenant silently restores permissions an administrator deliberately revoked. | VERIFIED |
| O8 | `docker-compose.yml` has no `image:` key, so the previous image is dangling after a build. Rollback must rebuild from source over the network inside an already-failing window. There is also no dispatchable rollback path. | REPORTED |
| O9 | `docs/kaaf/GOVERNANCE.md` is cited 8 times, including as `"governance"` in the generated `.ai/ai-context.json`, and does not exist in any commit. | VERIFIED |
| O10 | `kaaf.module.json` still declares Passenger/PM2 as a **required** production integration, and that propagates into `.ai/summary.md` as a structured claim. CI is green on it. | REPORTED |
| O11 | `hostinger-release-layout-diagnostic.yml` is dispatchable, uses `environment: production` and targets `/home/u716763642/domains/...` — the retired host. `build-hostinger-native.yml` builds for glibc 2.28 on every `package.json` change. | VERIFIED (files exist) |
| O12 | 17 of 42 documents in `docs/` still describe Passenger / `~/domains` / `alt-nodejs`. `CLAUDE.md` classifies any such instruction as a defect. | VERIFIED |
| O13 | `setup.js:57` and `install-starter-data.js:167` both assert that unbinned stock cannot be allocated. The allocator has **no** `bin_location` predicate. The statement is false, and it is repeated in three places. | VERIFIED |

### Commercial
| id | finding | evidence |
| --- | --- | --- |
| D1 | No spend-by-project report anywhere; `wbs_element` appears in none of `kpi.js`, `dashboard.js`, `analytics.js`. The project field is free text with no register, no column and no filter. `requiredRequestFields` is declared and unread. | VERIFIED |
| D2 | No currency figure on any reachable screen. Dashboard tiles sum BAG + TON + M3 into one number. | VERIFIED |
| D3 | `ai_analytics` is in no profile, so the screen is unreachable for everyone including the administrator. | VERIFIED |
| D4 | `create-demo-tenant.js` never demonstrates the SoD refusal — the product's strongest control is invisible in its own demo. | REPORTED |
| D5 | `landing.js` sells a generic WMS; journey step 2 promises "create the ERP reservation". | REPORTED |

---

## 3. Execution order

Principles: nothing that moves data ships with anything else; nothing user-visible ships
before the pipeline can prove what it is serving; each wave ends at a verifiable point.

### Wave 0 — baseline (no code, human-dispatched)
Deploy `40e68bc` as a **catch-up release carrying no corrective content**. `plan_only` first,
read the output, then dispatch for real. Confirm row counts, `schema_migrations 25 → 27`,
`PRAGMA integrity_check`, and manually probe a file that exists only in the new code.
Update `docs/WMS-CURRENT-STATUS.md`.

*Why first:* without it, every later row-count comparison is measured against the wrong
baseline, and the first corrective deploy would carry seven unrelated commits.

### Wave 1 — guardrails (4 PRs, no user-visible change)
| PR | contents | fixes |
| --- | --- | --- |
| 1 | `tests/run.sh` DB_PATH/NODE_ENV/path refusal; `fresh-start.js` production guard modelled on `reset-admin.js`; `create-demo-tenant.js` existence check extended to `-wal`/`-shm`; `install-starter-data.js` gains the production-path refusal | O1, O2 |
| 2 | `BUILD_SHA` build-arg → `/healthz` returns it → the release workflow asserts it matches the requested ref | O4 |
| 3 | Unpin `/release-assets/9d79a00/`, or drive the segment from `BUILD_SHA` | O5 |
| 4 | Deploy-gate watch list extended; `expected_row_delta` input; pre-build image tagging so rollback is a retag; backup manifest echoed; `rollback_to` dispatch input | O6, O8 |

PR 1 ships alone. It is the one PR whose absence can end the programme.

→ **Deploy Wave 1.** First deploy where "did it land" has a machine answer.

### Wave 2 — repo reality (2 PRs, zero runtime effect)
| PR | contents | fixes |
| --- | --- | --- |
| 5 | Delete `hostinger-release-layout-diagnostic.yml`, `build-hostinger-native.yml`, `ecosystem.config.js`; rewrite `kaaf.module.json` integrations to Docker Compose; regenerate `.ai/`; resolve the `docs/kaaf/GOVERNANCE.md` citations | O9, O10, O11 |
| 6 | Supersession banners on the 17 Passenger-era documents; correct the false bin-requirement text in `setup.js` and `install-starter-data.js`; retarget `ANDROID-UAT-V1.0.md` at a provisioned test tenant and fill its header | O12, O13, C10 |

PR 5 ships alone so the KAAF regeneration churn does not hide a real diff.

### Wave 3 — data (3 PRs, each deployed alone)
**Blocked on the security and data-truth passes (§0.2).**

| PR | contents | classification | fixes |
| --- | --- | --- | --- |
| 7 | `site_storekeeper` role as an **additive migration** (new role, grants for the new role only, assigned to no user) plus the matching seed edit for new tenants | MIGRATION — a seed edit alone reaches no existing tenant, because `npm run seed` is forbidden in production | A4 |
| 8 | `materials.js` list endpoint uses the same `COALESCE` fallback the search endpoint already uses | CODE — no data moves, reverts cleanly | A10 |
| 9 | `install-starter-data.js` sets the batch/expiry flags for **new tenants only** | CODE | A8 |

**Explicitly out of scope:** any bulk `UPDATE` of `is_batch_managed` on existing materials.
Production holds ~9,700 real imported materials; the flag is copied onto request lines at
creation time, so a blanket update splits behaviour mid-flight for open work — and the deploy
gate cannot see a column change at all. If the owner wants it, it is a feature (editable
column, import field, audit trail), not a migration.

**Not a PR:** the subcontractor-ledger convergence. Run the read-only report first to learn
whether anything remains. If it does, it becomes an out-of-band operation *after* the UI stops
writing legacy rows — with a verified backup, a reversal script written in advance, and no
deploy in flight. It writes to `batches`, which the gate watches, so shipping it inside a
deploy guarantees a false rollback that leaves the rows behind.

### Wave 4 — engine, then screens (4 PRs)
| PR | contents | fixes |
| --- | --- | --- |
| 10 | `owner_type` predicate in `allocation.js`; `activeFreeze` in `picking.js` and `gi.js`; `reservation_number` enforced on OUT | A2, A3, A5 |
| 11 | Claim button on My Picking Tasks; Picker Assignment role filter. **Depends on PR 7 deployed and verified, not merely merged** | A1 |
| 12 | Light-theme status tokens; `.btn.success` specificity; a real `.btn.warn` rule. **Blocked on PR 3 deployed** | B1, B2 |
| 13 | Approvals partial-decision bug; mouse-wheel quality mutation; remove the simulate-error control; checklist permission filter; dead route; chart empty guard; missing empty states | B3–B8 |

PR 10 must not ship with UI changes: if a picking screen breaks, the cause must be unambiguous.

### Wave 5 — mobile (separate track, separate cadence)
| PR | contents | fixes |
| --- | --- | --- |
| 14 | Release signing config; remove the fabricated GI number; `owner_type` on receiving; clear the queue on sign-out; regenerate `pubspec.lock`; remove the dormant languages | C1, C2, C4, C5, C8, C9 |

Then the narrowing decision: cut the menu to the six screens a storekeeper uses in a yard
(Scan Bin, Goods Receipt, My Picking Tasks, Goods Issue Posting, Cycle Counting, Physical
Inventory) and delete the rest from the mobile menu. That single change removes most of the
name-table divergence, the whole edition-gate problem, and the segregation-of-duties surface —
and halves the maintenance the app demands. C3 and every other mobile item close only on a
device against a deployed tenant.

### Wave 6 — commercial value (3 PRs)
| PR | contents | fixes |
| --- | --- | --- |
| 15 | Spend-by-project report: `stock_transactions → material_request_lines → material_request_headers.wbs_element × materials.price`; enforce `requiredRequestFields` server-side; project becomes a register-backed dropdown; project column and filter on the requests list | D1 |
| 16 | Deliver `terminology` from `/api/auth/me` and apply it; display maps for the raw enums; drop the impossible stage and the unreachable status options | B11 |
| 17 | Currency on the dashboard tiles (pending the data-truth verdict on `materials.price`); demo script that triggers the SoD refusal; landing page rewritten for contracting | D2, D4, D5 |

### Deferred by decision, recorded so they are not rediscovered
- Bulk `is_batch_managed` on existing materials (Wave 3 note).
- Deleting `material_location_stock` rows — destructive, breaks the legacy location screens,
  and unnecessary once PR 8 lands.
- Arabic. `ENABLED_LANGS=['en']` is implemented cleanly and consistently; the machinery is
  dormant, not half-wired. If it is ever taken up, scope it to the ~150 strings on the
  yard-facing path, not the 1,348 in the baseline.
- 3D warehouse view and any further analytics. Both already assessed and declined.
- Screen consolidation (B12) — real, but it is a product decision, not a defect.

---

## 4. Guards, so this does not recur

A fix without a guard is a fix that comes back. Each guard must be mutation-tested: break the
code deliberately and confirm the guard fails.

| Guard | Pins |
| --- | --- |
| Browser test that **clicks** the claim control rather than calling the API | A1, and the test that passed on a dead screen |
| Allocation test: release a SUBCONTRACTOR batch, raise a company request, assert full shortfall | A2 |
| Freeze test: open a count, attempt a pick and a GI, assert both refuse | A3 |
| Contrast assertion over the computed light-theme palette | B1, B2 |
| Approval test: untick lines, press Approve, assert the unticked lines are not approved | B6 |
| Route-integrity test: every `href="#/..."` in `public/js` resolves to a registered route | B7, B15 |
| Name-table test extended to parse `home_screen.dart` | C7 |
| `tests/run.sh` refuses to run when `DB_PATH` points outside the repo | O1 |
| Deploy asserts the served `BUILD_SHA` equals the requested ref | O4 |
| Doc test: every `docs/**` path cited in code or `.ai/` exists | O9 |

---

## 5. What a human must do, and when

1. **Now:** dispatch the Wave 0 catch-up release — `plan_only` first, read it, then for real.
   This touches the production database (migration 027 writes rows). It needs explicit approval.
2. **Before Wave 3:** configure required reviewers on the `production` GitHub environment, then
   dispatch once and confirm a run actually stops at the gate. A comment saying a gate exists is
   not evidence that it fires.
3. **Until PR 1 lands:** nobody runs `npm test`, `npm run seed` or `npm run fresh-start` inside
   the production container.
4. **Wave 5:** a physical device against a provisioned test tenant — not production.
5. **Throughout:** the owner using the product for a day. No agent in this programme can
   substitute for it; none of the nine noticed that a screen is annoying to use.

## 6. What could not be verified from here
Production runtime state (deployed SHA, row counts, integrity, whether 026/027 applied, whether
any batch sits binless, how many materials hold both batch and location stock). Whether the
`production` environment has reviewers. Every mobile item marked DEVICE. All read-only checks;
none were run.
