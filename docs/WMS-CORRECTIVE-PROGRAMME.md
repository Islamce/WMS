# WMS Corrective Programme

**Status:** v1.0 — all nine audits complete. §0.2 records what each one changed.
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

### 0.2 The three outstanding passes, and what they changed

All three have now run. Two of them **rejected** items this plan had proposed, and one
found a class of defect the plan did not contain at all. Nothing here is a footnote.

| Pass | Verdict |
| --- | --- |
| **Security** | Found thirteen findings, several executed live against throwaway tenants. Two are **standing** on the public production host, not conditional. It also answered both questions §0.2 had blocked PRs on — recorded under Wave 3 and Wave 4. |
| **Data truth** | Provisioned four tenants, ran the real endpoints, and proved that "how much stock do we have" has **six different answers on six screens**. It **rejected PR 8 as specified** and **rejected PR 17 outright**. |
| **Performance** | Built 210 MB and 671 MB synthetic databases and timed the real endpoints. Found one endpoint that blocks the whole server for 164 seconds at ten times production size, and two missing indexes worth 456× and 106×. |

Three corrections to what this document previously asserted:

- **D3 was wrong.** `ai_analytics` is granted to six roles in `server/db/seed3.js`, and
  `/api/analytics` carries **no `requireModule` gate at all** — only `requirePermission`.
  The client hides the screen; the API does not. So the screen is unreachable in the UI and
  the endpoint is reachable by anyone holding the permission, whatever edition they bought.
  That is a client-side-only edition gate, which is a security finding, not a cosmetic one.
- **A10's classification was too kind.** "One query, one file" is how the *symptom* presents.
  The cause is two stock ledgers with two writers and no field recording which is authoritative.
- **A2 is no longer inference.** `allocation.propose()` was executed and returned a
  subcontractor-owned batch against a company request. It is the most serious item in the
  programme.

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

### Security — executed against throwaway tenants unless marked
| id | finding | evidence |
| --- | --- | --- |
| S1 | `npm test` or `npm run seed` in the production container deletes the database and installs accounts whose passwords are published in `README.md` on a **public** repository (`"private": false`, verified). `server/db/seed.js` has **no guard of any kind** — the four production environment variables gate only the boot-time auto-seed. The nine accounts include one holding `approvals` and one holding `gi_posting`, i.e. both halves of the segregation-of-duties pair. | EXECUTED |
| S2 | `POST /api/stock/out` removes stock with **no request, no approval, no SoD and no freeze check**. The only validation is that `reservation_number` is a non-empty string — `"MADE-UP-0001"` passes. `stock_out` is in `DEFAULT_USER_ROLE_PERMISSIONS`, which is what self-signup assigns. The screen is in `ROUTE_PAGES` but in **no menu**, so no administrator reviewing the UI would know it exists. | EXECUTED |
| S3 | Unauthenticated self-registration is open on the public host. No CAPTCHA, no invite, no per-endpoint limit. The account lands `pending`, so the exploit is the chain: a stranger looks like a real hire, one approval click makes them active, and S2 then lets them take stock out. | EXECUTED |
| S4 | Cycle Counting is a **one-person stock write-off**. Open a count, enter zero, post — no approval, no recount, no SoD, no value threshold, and `activeFreeze` is not imported in the file at all. The fastest way to make material disappear from the books is not a goods issue. | VERIFIED |
| S5 | A frozen physical inventory does not stop picking or goods issue. Receiving refuses; claim, confirm and GI all succeed. The count posting then writes `ADJUSTMENT_OUT` for the same units, so they leave the ledger **twice** — or, under blind counting, the issued material is put **back** on the books with no adjustment at all. | EXECUTED |
| S6 | Same as A2, proved a second way: subcontractor-owned stock received, released, binned; company batches zeroed; a plain company request allocated against the subcontractor's batch. | EXECUTED |
| S7 | The value-based approval authority never fires, because `materials.price` is never populated — `install-starter-data.js` inserts materials with no price column and the default is 0. Every request values at zero, so the "senior approval above 1,000" threshold is inert. A control the product reports as present is absent. | VERIFIED |
| S8–S13 | Idempotency keys global rather than per-user and predictable on mobile; the offline queue survives sign-out; the debug-signed APK is published on a **public** GitHub Release; a test hook can force-release every reservation while the audit trail blames the scheduler; `users_management` is administrator-equivalent with unguarded self-grant; the public repository carries the production operational map. | REPORTED |

### Data truth — measured against running endpoints
| id | finding |
| --- | --- |
| T1 | One material, one database, one moment: the dashboard says 460, the Materials master says 460, its "Available" column says 405, the request screen says 405, analytics says 245, its issuable figure says 135 — and the engine hands out **295**. Not one label says which question it is answering. |
| T2 | Every dashboard stock total adds BAG to TON to M3. "Stock on hand: 530" is not a quantity of anything. Same for the bin ranking, the group chart and the location chart. |
| T3 | The request screen's "Available stock" ignores owner, quality and block — it shows 405 where 135 is issuable, and renders it in red/green as if authoritative. |
| T4 | The analytics row's own three figures do not reconcile: 135 + 115 ≠ 245, because one is net of reservation and the other is gross. The dashboard's equivalent four tiles **do** reconcile, so the product gets this right on one screen and wrong on another. |
| T5 | Three percentages over a zero denominator survive the earlier `erp_success_rate` fix: shortage percentage renders a **green "clear"** card on a tenant that has never raised a request; FIFO/FEFO "compliance" is graded by the engine that wrote the number; QR pass/fail is structurally zero because the flags that gate the writing path are never set. |
| T6 | `avg_approval_to_issue_minutes` — the replacement for the two null'd ERP cycle times — has the exact defect it was introduced to fix. `approved_at` is a datetime and `gi_posting_date` is a date, so a same-day request computes −540 minutes, and the clamp is applied to the **average** rather than per row. A single same-day request renders as "0", i.e. instant. |
| T7 | `erp_success_rate` reads **100%** on a tenant with no ERP, because contracting GI posting still logs a `GI_POSTING / SUCCESS` row for every locally minted number. The dashboard hides this metric on such a tenant; the KPI screen does not. |
| T8 | "Export Audit Trail" exports **25 rows of 302** and says nothing: the client asks for 5,000, the validator caps at 100 and silently falls back to the default of 25. "Export the full filtered list" exports **100 of 314**; production holds ~9,700. |
| T9 | Four document numbers are still `COUNT(*) + 1` after the sequence service was introduced: `MR-`, `PI-`, `SCR-`, and the batch-split suffix. |
| T10 | Twenty-one dead columns. The `supervisor_override_*` group is the one that matters: the KPI screen reports an override **count** while the four columns that would say which line, by whom and why are never written. |
| T11 | `tests/e2e/analytics_truth_test.py` passes 27 assertions on a baseline containing A2, A10 and A11. It never calls the allocation engine, never calls `/api/materials`, never calls `/api/materials/search`, and its fixture contains no `material_location_stock` rows — so two of the three defects are structurally unreachable from it. The fixture has decayed into one that cannot fail. |

### Performance — measured on synthetic datasets at 10× and 1M rows
The mechanism that ranks everything: `better-sqlite3` is synchronous, so a slow read does not
just slow a screen — it **blocks the event loop**, and every other user with it. Measured:
`GET /healthz` took 1,628 ms while one bins query was in flight, and a stock-in write went from
5 ms to 1,577 ms. "A slow screen" and "a blocked goods issue" are the same defect here.

| id | finding | measured |
| --- | --- | --- |
| P1 | `GET /api/analytics` blocks the whole server. A quadratic de-duplication loop, plus 90 date strings regenerated per material. | **1,187 ms today**; **164 seconds** at 10×, returning 33.8 MB. Hoisting the date strings alone: 1,018 → 20 ms at today's size. |
| P2 | Warehouse Queue — the screen the storekeeper lives on — does a full scan of `picking_tasks` per row. One missing index. | **6,935 → 15 ms.** 456×. |
| P3 | `/api/dashboard/bins` builds a throwaway index on every request and returns every bin with its full contents, unpaginated. | **1,277 → 12 ms** with the right index. A *partial* index makes it 4× **worse** — measured. |
| P4 | Mobile material search fires one request per keystroke, undebounced. | 12 requests per search; ≈3.6 s on a site 3G link versus 300 ms. |
| P5 | The dashboard wraps `transaction_date` in `date()` five times per load, defeating the index. | **136 → 0.9 ms** each at 1M. Output verified byte-identical. |
| P6 | No response compression anywhere — not in Express, not in Caddy. | 3.5 MB → 383 KB on the mobile bin screen. Three lines. |
| P7 | `/api/receiving/pending-gr` is unbounded **and never drains**: the opening-stock importer writes batches with no `gr_number`, so all ~9,700 of production's opening-stock batches sit on that screen permanently. | 6.3 MB at 10×. |
| P8 | The CI load test cannot detect a single finding above: it runs against ~20 seeded rows and probes five endpoints, none of them the slow ones. `write-contention.js` is well designed and is not wired into `npm run test:load`. | — |

## 3. Execution order

Principles: nothing that moves data ships with anything else; nothing user-visible ships
before the pipeline can prove what it is serving; each wave ends at a verifiable point.

### Wave −1 — close what is open right now (1 PR, server code only, no production operation)
This did not exist in v0.9 because the security pass had not run. It now comes first: S2 and S3
together are a **standing** path on the live public host, not a conditional one, and S1 is a
loaded gun pointed at the production database for the duration of this programme.

| contents | closes |
| --- | --- |
| Delete `POST /api/auth/signup` and the sign-up link | S3 |
| Remove `stock_in`/`stock_out` from `DEFAULT_USER_ROLE_PERMISSIONS`, plus a migration revoking both from the `user` role on existing tenants | S2 |
| `DB_PATH` / `NODE_ENV` / path refusal in `tests/run.sh`, and a production guard in `server/db/seed.js` and `scripts/fresh-start.js` modelled on `reset-admin.js` | S1 |
| `activeFreeze` in `picking.js` and `gi.js` | S5, A3 |
| `owner_type` predicate in `allocation.js` | S6, A2 |
| Remove the default passwords from `README.md` | defence in depth |

Nothing here touches the production database, needs a migration to land first, or depends on
the catch-up deploy. It ships as one PR because the items are individually small and jointly
the difference between a product that can be piloted and one that should not be.

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
| 1 | What Wave −1 did not already cover: `create-demo-tenant.js` existence check extended to `-wal`/`-shm`, and `install-starter-data.js` gains the production-path refusal. (The `tests/run.sh`, `seed.js` and `fresh-start.js` guards moved forward into Wave −1 once the security pass showed how exposed they are.) | O1, O2 |
| 2 | `BUILD_SHA` build-arg → `/healthz` returns it → the release workflow asserts it matches the requested ref | O4 |
| 3 | Unpin `/release-assets/9d79a00/`, or drive the segment from `BUILD_SHA` | O5 |
| 4 | Deploy-gate watch list extended; `expected_row_delta` input; pre-build image tagging so rollback is a retag; backup manifest echoed; `rollback_to` dispatch input | O6, O8 |

Wave −1 carries what used to make PR 1 urgent; what remains here is ordinary hardening.

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
| 7 | `site_storekeeper` role as an **additive migration** (new role, grants for the new role only, assigned to no user) plus the matching seed edit for new tenants. The security pass's answer to whether this collapses a real control: the segregation of duties the product advertises protects the *goods issue*, and the fastest route to making material disappear is **not** a goods issue — it is a cycle count, which today needs one signature and is already held by two seeded roles (S4). Fix the cycle count in the same wave, or the role is being argued about at the wrong door. | MIGRATION — a seed edit alone reaches no existing tenant, because `npm run seed` is forbidden in production | A4, S4 |
| 8 | **Rewritten.** The bare `COALESCE` this document proposed in v0.9 is **wrong** and must not ship: `COALESCE(SUM(x), …)` falls through only when there are *no rows*, so a material with a depleted batch row plus legacy stock returns **zero** — proved on a live endpoint. And `/api/stock/in` writes legacy rows with no batch at all, so the two ledgers can both legitimately hold stock. Ship instead an expression that subtracts only the overlap the opening-stock import created, identified by the bin code both writers share, plus a field naming which ledgers contributed. Preceded by one read-only production query that settles whether either wrong answer would have been visible. | CODE — no data moves | A10 |
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
| 17 | **Rewritten.** Multiplying stock by `materials.price` is **rejected**: the column has no provenance, no effective date, no valuation basis and no aggregated currency, `Number(x) \|\| 0` turns any blank into zero, and the analytics screen already performs this exact multiplication and renders **"Total Stock Value — 0"** on a tenant holding 530 units. It converts a number that merely looks odd into one that looks authoritative and is wrong. Ship **per-unit subtotals** instead — no price needed, correct from day one. Then, separately: make `price` nullable and distinguishable from zero, refuse to aggregate across currencies, and say "not available (N of M unpriced)" rather than summing the priced ones. Plus the demo script that triggers the SoD refusal, and the landing page rewrite. | D2, D4, D5, T2, S7 |

### Wave 7 — performance (2 PRs, every payoff measured)
None of this is blocked by anything else in the programme.

| PR | contents | measured payoff |
| --- | --- | --- |
| 18 | Six changes, each between one and ten lines, all independent, none altering a single output value: the two missing indexes; hoist the 90 date strings; replace the quadratic de-duplication with a `Set`; `app.use(compression())`; drop `date()` from the five dashboard movement queries. | 6,935 → 15 ms; 1,277 → 12 ms; 1,018 → 20 ms; 131 s → 50 ms; 3.5 MB → 383 KB; 136 → 0.9 ms |
| 19 | Paginate `/api/dashboard/bins` and drop the per-bin contents; exclude opening stock from Pending GR; drop the joins from the transactions count when no search is given; debounce the mobile search. | 3.5 MB → ~40 KB/page; 6.3 MB → ~30 KB; 2,060 → ~30 ms; 12 requests → 1 |

And the gate that would have caught all of it: extend the scale seeder to populate batches,
bins, requests, tasks, audit and movement history (19 seconds for a 210 MB dataset), point the
load test at that instead of the ~20 seeded rows, add the seven slow endpoints to its route
list, and wire `write-contention.js` into `npm run test:load` — because on a synchronous
database the number that matters is write latency while a read is in flight.

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
| Materials list and request screen return the same figure for a material holding **both** batch and legacy stock, and neither returns zero — the pair fails today under `+` and under bare `COALESCE`, so it rejects both wrong answers | A10 |
| A cycle time over zero completed requests is `null`, not `0`, and a same-day request does not average negative | T6 |
| A signed-up user cannot reach any stock-mutating route | S2, S3 |
| Load test runs against the scale dataset, covers the seven slow endpoints, and asserts write latency under concurrent read | P1–P8 |

---

## 5. What a human must do, and when

1. **First, before anything else:** review and merge Wave −1. Two of its items close a path
   that is open on the live public host today. None of it touches production data.
2. **Then:** dispatch the Wave 0 catch-up release — `plan_only` first, read it, then for real.
   This touches the production database (migration 027 writes rows). It needs explicit approval.
3. **Before Wave 3:** configure required reviewers on the `production` GitHub environment, then
   dispatch once and confirm a run actually stops at the gate. A comment saying a gate exists is
   not evidence that it fires.
4. **Until Wave −1 lands:** nobody runs `npm test`, `npm run seed` or `npm run fresh-start` inside
   the production container.
5. **Wave 5:** a physical device against a provisioned test tenant — not production.
6. **Throughout:** the owner using the product for a day. No agent in this programme can
   substitute for it; none of the nine noticed that a screen is annoying to use.

## 6. What could not be verified from here
Production runtime state (deployed SHA, row counts, integrity, whether 026/027 applied, whether
any batch sits binless, how many materials hold both batch and location stock). Whether the
`production` environment has reviewers. Every mobile item marked DEVICE. All read-only checks;
none were run.
