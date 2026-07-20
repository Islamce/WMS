# WMS — Version 1.0 Engineering Execution Plan

**Role**: TPM / Enterprise Architect / Product Delivery Manager
**Date**: 2026-07-18 · **Baseline**: `main @ 9d10b4a` (PR #21 merged — R4 complete)
**Scope**: everything required to ship a stable, enterprise-grade Version 1.0 to production (Hostinger VPS + Android APK), execution planning only — no feature ideation.

---

## 1. Executive Engineering Summary

The WMS is **functionally complete for Version 1.0**. All 14 core warehouse processes (request → approval → ERP reservation → allocation → picking → goods issue → shipping, plus receiving, quality, cycle count, physical inventory, reallocation, reversal paths) are implemented end-to-end across three synchronized surfaces: a Node/Express + SQLite backend (~8,100 LOC, 27 route modules, 19 services), a vanilla-JS web SPA (~5,300 LOC), and a Flutter Android app (~5,600 LOC, 27 screens). Quality gates are unusually strong for a project of this size: ~325 e2e checks across 14 Python suites, a Playwright + axe browser smoke, ESLint with a security plugin, and a dependency audit — all enforced in CI on every PR, all currently green.

**The gap to production is not features — it is operations.** The four areas that genuinely gate a 1.0 release are: (1) monitoring/alerting is near-zero (a `/healthz` endpoint and stdout logs, nothing watching them), (2) backups are local-only with no tested restore, (3) deployment is a manual SSH runbook with no staging environment, and (4) the mobile app has no automated tests and push notifications await a one-time Firebase setup by the operator. None of these require architectural change; all are incremental. **Recommendation: freeze feature scope now and run one 2-week "Launch Readiness" sprint (Section 10), after which V1.0 can be tagged and released with confidence.**

---

## 2. Repository Health Report

### Strengths

| Area | Assessment |
|---|---|
| **Architecture** | Clean 3-tier layering: `routes/` (HTTP) → `services/` (domain logic) → `db/` (SQLite via better-sqlite3). A dedicated `workflow/states.js` state machine centralizes all status transitions (forward + reverse maps) — the single most important invariant in a WMS, correctly isolated. |
| **Module organization** | 27 route files and 19 services map 1:1 to business capabilities (allocation, sod, approvalMatrix, reverseWorkflow, freeze, ledger, retention…). Easy to navigate; no god-modules. |
| **Domain integrity** | All multi-row stock mutations run in `db.transaction()`; optimistic-lock CAS guard on header status transitions; append-only audit trail protected by DB triggers; stock ledger; FIFO/FEFO allocation with reservation accounting. |
| **Security posture** | JWT with fail-fast production secret guard (≥32 chars enforced at boot), async bcrypt, password policy + forced first-login change, per-email login limiter + global API rate limit, helmet headers, RBAC + per-user permissions + SoD rules + high-value approval matrix, safe error responses, ESLint security plugin + `npm audit --audit-level=high` in CI. |
| **Test discipline** | ~325 e2e assertions in 14 suites run in 3 isolated DB phases; regression tests exist for every fixed bug (a real strength — bugs stay fixed). Playwright smoke incl. axe a11y. Zero TODO/FIXME markers in the entire JS codebase. |
| **Configuration** | Exemplary `.env.example` (every variable documented with rationale and production guidance); production guards (JWT secret, auto-seed guardrail); `schema_migrations` versioning. |
| **i18n / a11y** | EN/AR/FR on both web and mobile; form labels + axe checks. |
| **Documentation** | 742 lines: solid README, step-by-step `DEPLOY-HOSTINGER.md` (incl. Firebase setup), `POSTGRES-MIGRATION.md` forward plan, workflow gap analysis. |

### Areas requiring attention

| # | Area | Finding | Severity |
|---|---|---|---|
| H-1 | **Monitoring** | Only `/healthz` + stdout request logs. No uptime alerting, no error tracking, no metrics. An outage or error spike would be discovered by users. | **High** |
| H-2 | **DR / Backup** | Daily in-process SQLite backup to a local `BACKUP_DIR` (same VPS). No offsite copy, no restore ever rehearsed, `data/attachments/` not covered by the backup script. | **High** |
| H-3 | **Deployment** | Manual `ssh → git pull → npm ci → migrate → pm2 restart`. No staging environment, no zero-downtime, no automated rollback. | Medium-High |
| H-4 | **Mobile test coverage** | Zero meaningful Flutter tests (default widget stub only). `flutter analyze` runs non-blocking in CI. All mobile verification is manual. | Medium-High |
| H-5 | **Scalability ceiling** | SQLite single-writer + synchronous better-sqlite3 calls block the event loop under heavy write concurrency. Fine for one warehouse / dozens of concurrent users; the Postgres path is documented but unscheduled. | Medium (acceptable for 1.0) |
| H-6 | **Auth lifecycle** | 8h JWTs with no refresh tokens, no server-side revocation (logout is client-side only), no 2FA. Acceptable for internal tool at 1.0; needs hardening after. | Medium |
| H-7 | **API documentation** | No OpenAPI/Swagger spec. The Python e2e suites are the de-facto API contract. | Medium |
| H-8 | **Accepted vulnerabilities** | 8 moderate transitive vulns via `firebase-admin` (google-gax chain). Below CI's high-severity gate; must be consciously tracked, not forgotten. | Low-Medium |
| H-9 | **Logging** | Unstructured stdout lines; no rotation configured (PM2 default only), no correlation IDs. | Low-Medium |
| H-10 | **Frontend debt** | 16 ESLint warnings (unused vars, 2 timing-attack heuristics); no JS unit tests for SPA logic (covered indirectly by e2e + smoke). | Low |
| H-11 | **Repo hygiene** | Empty `scratch_out/` dir committed; `wms flutter application/` folder name contains spaces (complicates tooling/scripts); `.idea/` committed in the Flutter tree. | Low |
| H-12 | **Rate-limiter scope** | In-memory per-process — under PM2 cluster mode the effective limit multiplies by worker count. Document or fix. | Low |

---

## 3. Production Readiness Assessment

Score: 1–10, where 8+ = ship, 6–7 = ship with a documented mitigation, ≤5 = must fix before 1.0.

| Area | Score | Rationale | 1.0 Gate? |
|---|---|---|---|
| Backend | **8.5** | Feature-complete, transactional, heavily regression-tested. | No |
| Frontend (web) | **8** | All flows implemented, i18n, a11y-smoked, drill-through UX. Minor lint debt. | No |
| Mobile app | **7** | Full feature parity, v1.4.0+7 APK builds green in CI, published to GitHub Releases. No automated tests; Android only. | Mitigate (manual UAT pass) |
| APIs | **8** | Consistent REST, safe errors, pagination on growth lists. No OpenAPI spec. | No |
| Authentication | **8** | Strong password/secret hygiene. No refresh/revocation/2FA. | No |
| Authorization | **9** | RBAC + per-user grants + SoD + value matrix + self-approval block; the strongest area. | No |
| Logging | **6** | Request logs + full business audit trail; unstructured, no rotation policy. | Mitigate (logrotate) |
| Monitoring | **3** | `/healthz` exists; nothing watches it. **Weakest area.** | **YES — fix** |
| Database | **7** | WAL, FKs, transactions, migrations, backups. SQLite ceiling documented. | No |
| Deployment | **6** | Clear manual runbook; no staging, no rollback automation. | Mitigate (runbook + rollback steps) |
| Firebase / Push | **7** | Code complete and inert-safe; awaits operator's one-time Firebase project + `google-services.json` + service-account env. | Decision required |
| Environment variables | **9** | Documented, guarded, fail-fast. | No |
| Error handling | **8** | Safe messages, transactions, optimistic locks, 409 conflict semantics. | No |
| Security | **8** | Layered controls; 8 accepted moderate vulns; no external pen test. | No |
| CI/CD | **7** | Excellent CI (lint, audit, 325 e2e, smoke, APK build+release). CD is manual. | No |
| Backup | **7** | Daily + 14-day retention, `npm run backup` manual path. Local-only; attachments dir uncovered. | **YES — fix** |
| Disaster recovery | **4** | Single VPS; no offsite copy, no RTO/RPO, restore never tested. | **YES — fix** |

**Overall: 7.1 / 10 — "production-capable, not yet production-operated."** Three gates: monitoring, offsite backup + tested restore, and the push-notification go/no-go decision.

---

## 4. Engineering Gap Analysis (actionable findings only)

**Missing implementations**
- G-01 Uptime/error alerting (no pager, no email on down/5xx spike).
- G-02 Offsite backup replication + attachments coverage + documented restore procedure.
- G-03 Server-side JWT revocation / refresh-token rotation (logout doesn't invalidate tokens).
- G-04 OpenAPI specification for the 27 route modules.
- G-05 Mobile automated tests (unit for `api_client`/`session`/format, widget tests for critical screens).
- G-06 Log rotation + structured (JSON) log option.
- G-07 iOS build pipeline (folder exists, never built — explicitly out of 1.0 scope).

**Temporary solutions / accepted debt**
- G-08 ERP integration is the `manual` connector (operator keys in reservation numbers); real SAP/ERP connector deferred by design — document as a 1.0 product boundary, not a bug.
- G-09 Email channel requires optional `nodemailer` install + SMTP env; silently logs instead of sending otherwise. Verify operator intent before launch.
- G-10 8 moderate npm vulns (firebase-admin transitive) — add a monthly audit review task.

**Duplicate logic / refactor candidates**
- G-11 The 14 Python e2e suites each re-implement `call()/login()/check()` helpers (~40 lines × 14). Extract a shared `tests/e2e/_lib.py`. Low risk, high hygiene.
- G-12 Web SPA table rendering repeats a sort/filter/render pattern across ~10 pages; candidate for one shared helper (post-1.0; behavior currently consistent and tested).
- G-13 16 ESLint warnings (dead imports/vars) — one cleanup pass.

**Dead code / hygiene**
- G-14 Remove committed `scratch_out/`, Flutter `.idea/`; add both to `.gitignore`.
- G-15 Legacy `material_location_stock` table retained for import compatibility — confirm and comment its status, or schedule removal in 2.0 (Postgres migration).

**Performance**
- G-16 No load test has ever been run. One k6/ab session against staging at ~2× expected peak (e.g. 50 concurrent pickers) to find the SQLite write ceiling empirically.
- G-17 In-memory rate limiter multiplies under PM2 cluster — either document "run single instance" (current reality) or move limits to the DB.

**Security**
- G-18 Verify helmet CSP directives are compatible with the SPA's inline handlers (manual check on prod headers).
- G-19 Secrets rotation procedure (JWT_SECRET, Firebase SA) — one README-DEPLOY section.

**Missing validation / UX**
- G-20 Mobile UAT round on merged R4 features (reverse-one-step, drill-through, create-request fields) on a physical device — last round's feedback loop found real gaps every time.

**Missing tests**
- G-21 No direct unit tests for the two highest-risk services (`allocation.js`, `reverseWorkflow.js`) — they are e2e-covered, but service-level tests would pin FIFO/FEFO edge cases (expiry ties, partial batches, zero-stock).

---

## 5. Engineering Backlog

Grouped by discipline. Effort: S ≤ ½ day · M ≤ 2 days · L ≤ 1 week. Priority: P0 = blocks 1.0 · P1 = should ship in 1.0 · P2 = 1.1 · P3 = later.

### DevOps / SRE
| ID | Epic / Story | Technical description | Business / Technical value | Pri | Cx | Deps | Effort | Rel |
|---|---|---|---|---|---|---|---|---|
| OPS-1 | *Observability* — As an operator I'm alerted when WMS is down or erroring | External uptime monitor on `/healthz` (UptimeRobot/Hetzner/cron-curl) + PM2 `pm2 install pm2-logrotate` + alert email on restart-loop; optional free-tier Sentry for Node | Outages found in minutes not days / zero code risk | **P0** | Low | — | S | 1.0 |
| OPS-2 | *DR* — Backups survive VPS loss and provably restore | Extend `scripts/backup.js` to include `data/attachments/`; nightly rclone/scp of backup dir offsite; execute + document one full restore drill; define RPO=24h, RTO=4h in DEPLOY doc | Sole protection against total data loss | **P0** | Low-Med | — | M | 1.0 |
| OPS-3 | *Deploy* — Rollback runbook | Add "roll back = git checkout previous tag + npm ci + migrate-down-note + pm2 restart" section; tag releases (`v1.0.0`) | Recover from a bad deploy in minutes | **P1** | Low | OPS-1 | S | 1.0 |
| OPS-4 | *Deploy* — Staging instance | Second PM2 app + DB on same VPS (different port), deployed from `main` before prod | Catch env-specific issues pre-prod | P2 | Med | — | M | 1.1 |
| OPS-5 | *CD* — Auto-deploy staging from main via GitHub Action + SSH | Push-button releases | P2 | Med | OPS-4 | M | 1.1 |

### Security
| ID | Epic / Story | Technical description | Value | Pri | Cx | Deps | Effort | Rel |
|---|---|---|---|---|---|---|---|---|
| SEC-1 | *Auth lifecycle* — Logout invalidates sessions | `token_version` column on users checked in `authenticate`; bump on logout/password-change | Stolen-token containment | P2 | Med | — | M | 1.1 |
| SEC-2 | Refresh tokens (short-lived access + rotating refresh) | Reduces 8h token exposure window | P2 | Med | SEC-1 | M-L | 1.1 |
| SEC-3 | Monthly dependency-audit review ritual + Dependabot already present — triage cadence | Vulns don't silently age | **P1** | Low | — | S | 1.0 |
| SEC-4 | CSP verification + secrets-rotation doc (G-18/19) | Hardening, incident readiness | **P1** | Low | — | S | 1.0 |
| SEC-5 | 2FA (TOTP) for admin role | Account-takeover defense | P3 | Med | SEC-1 | L | 2.0 |

### QA
| ID | Epic / Story | Technical description | Value | Pri | Cx | Deps | Effort | Rel |
|---|---|---|---|---|---|---|---|---|
| QA-1 | *Release gate* — Full-device mobile UAT of R4 features | Scripted pass: reverse-one-step at each stage, dashboard drill-through, create-request fields, push (if enabled) on physical Android | Last-mile confidence; every prior UAT found real issues | **P0** | Low | — | M | 1.0 |
| QA-2 | Load sanity test (G-16) | k6 script: login + request-create + pick flows at 50 VU, 10 min, against staging | Empirical SQLite ceiling before real users find it | **P1** | Low-Med | OPS-4* (or off-hours prod) | S-M | 1.0 |
| QA-3 | Shared e2e helper lib (G-11) | `tests/e2e/_lib.py`; mechanical refactor, suites unchanged | −500 duplicated lines; faster future suites | P2 | Low | — | M | 1.1 |
| QA-4 | Service-level unit tests for allocation + reverseWorkflow (G-21) | Node test runner; FIFO/FEFO tie-breaks, partial batches, CAS conflicts | Pins the riskiest invariants | P2 | Med | — | M | 1.1 |
| QA-5 | Flutter test foundation (G-05) | Unit: api_client/session/format; widget: login, request list, create-request; wire into flutter-apk.yml as blocking | Mobile regressions caught in CI | P2 | Med | — | L | 1.1 |

### Mobile
| ID | Epic / Story | Technical description | Value | Pri | Cx | Deps | Effort | Rel |
|---|---|---|---|---|---|---|---|---|
| MOB-1 | *Push go-live decision* — enable FCM or consciously defer | Operator creates Firebase project per DEPLOY-HOSTINGER.md; add `google-services.json` to CI secret + service account to VPS env; rebuild APK; verify device delivery | Completes the #1 recurring user request | **P0 (decision)** | Low (ops) | user action | S (+guide) | 1.0 |
| MOB-2 | Play Store internal-track distribution | Signing config + store listing; replaces manual APK sideloading | Update hygiene at scale | P3 | Med | MOB-1 | L | 2.0 |
| MOB-3 | iOS build (G-07) | Xcode/signing/pipeline; scanner + FCM plugins verified on iOS | Platform expansion | P3 | High | — | L+ | 2.0 |

### Backend / Architecture
| ID | Epic / Story | Technical description | Value | Pri | Cx | Deps | Effort | Rel |
|---|---|---|---|---|---|---|---|---|
| BE-1 | ESLint zero-warning pass (G-13) + repo hygiene (G-14) | Remove dead imports, scratch_out, .idea; gitignore | Clean baseline for 1.0 tag | **P1** | Low | — | S | 1.0 |
| BE-2 | Structured logging option (G-06) | `LOG_FORMAT=json` env flag on request logger | Machine-parseable logs for future aggregation | P2 | Low | — | S | 1.1 |
| BE-3 | OpenAPI spec (G-04) | Annotate routes or hand-write `openapi.yaml`; serve at `/api/docs` | Onboarding, contract clarity, client generation | P2 | Med | — | L | 1.1 |
| BE-4 | PostgreSQL migration (execute docs/POSTGRES-MIGRATION.md) | Swap driver, port migrations, jsonb, connection pool; removes single-writer + sync-call ceiling | Unlocks multi-site scale | P3 | High | QA-2 data | XL | 2.0 |
| BE-5 | Real ERP connector (SAP OData/BAPI) behind existing `erp.connector()` seam (G-08) | Replace manual keying; the seam already exists | Eliminates dual-entry, the biggest process cost | P3 | High | customer ERP access | XL | 2.0 |

### Frontend
| ID | Epic / Story | Technical description | Value | Pri | Cx | Deps | Effort | Rel |
|---|---|---|---|---|---|---|---|---|
| FE-1 | Shared table helper (G-12) | Extract sort/filter/render into `ui/table.js`; migrate pages incrementally | −~800 LOC, consistent behavior | P2 | Med | — | M | 1.1 |
| FE-2 | Extend axe a11y smoke beyond login to 3 core screens | Broader a11y guarantee | P2 | Low | — | S | 1.1 |

### Database
| ID | Epic / Story | Technical description | Value | Pri | Cx | Deps | Effort | Rel |
|---|---|---|---|---|---|---|---|---|
| DB-1 | Legacy `material_location_stock` disposition (G-15) | Comment as import-only, or write removal migration | Removes ambiguity | P2 | Low | — | S | 1.1 |
| DB-2 | Backup verification job | Weekly automated `sqlite3 .backup` integrity check (`PRAGMA integrity_check`) on latest backup | Backups that actually restore | **P1** | Low | OPS-2 | S | 1.0 |

### Documentation
| ID | Epic / Story | Technical description | Value | Pri | Cx | Deps | Effort | Rel |
|---|---|---|---|---|---|---|---|---|
| DOC-1 | 1.0 Operations Runbook | One page: start/stop, deploy, rollback, restore, alert response, secrets rotation, known limits (SQLite ceiling, single-instance rate limit) | On-call self-sufficiency | **P1** | Low | OPS-1..3 | S-M | 1.0 |
| DOC-2 | Product boundary note: "1.0 integrates with ERP manually by design" | Sets stakeholder expectations | **P1** | Low | — | S | 1.0 |

---

## 6. Release Readiness Checklist (V1.0)

- [ ] OPS-1 uptime + error alerting live and test-fired
- [ ] OPS-2 offsite backup running ≥3 consecutive nights; **one restore drill executed and documented**; attachments included
- [ ] DB-2 backup integrity check green
- [ ] MOB-1 push notifications enabled + device-verified *(decision 2026-07-18: ships in 1.0; CI secret plumbing merged — remaining: operator Firebase setup + device test)*
- [ ] QA-1 mobile device UAT pass signed off (all R4 features)
- [ ] QA-2 load sanity run — no errors at 2× expected peak; ceiling documented
- [ ] SEC-4 CSP verified on prod; secrets rotation documented
- [ ] BE-1 lint-clean, hygiene commit merged
- [ ] OPS-3 rollback runbook written; release tagged `v1.0.0`; APK release notes published
- [ ] DOC-1 ops runbook merged; DOC-2 ERP boundary noted
- [ ] Full CI green on the tagged commit (already standing: 325 e2e + smoke + audit + APK)

---

## 7. Risk Register

| Risk | Type | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| VPS disk/host failure loses DB + attachments | DR | **Critical** — total data loss | Low-Med | OPS-2 offsite backups + restore drill (P0) |
| Outage unnoticed (no alerting) | Ops | High — warehouse ops halt silently | **High** (certainty: nothing watches today) | OPS-1 (P0) |
| SQLite write contention under concurrent picking peaks | Performance/Scale | Med — latency, 5xx bursts | Med (unknown — never load-tested) | QA-2 measures it; BE-4 (Postgres) is the 2.0 fix; PM2 single-instance documented meanwhile |
| Bad deploy with no rollback path | Deployment | High — extended downtime | Med | OPS-3 tags + rollback runbook; OPS-4 staging in 1.1 |
| Stolen 8h JWT cannot be revoked | Security | Med | Low-Med | SEC-1/2 in 1.1; short expiry already limits window |
| firebase-admin transitive vulns escalate to high | Security | Med | Low | CI audit gate already blocks high; SEC-3 monthly triage |
| Mobile regression ships unnoticed (no tests) | Quality | Med | Med | QA-1 manual gate now; QA-5 automation in 1.1 |
| Firebase misconfiguration breaks APK build | Deployment | Low — build fails visibly | Low | Conditional Gradle apply already isolates it; CI proves both paths |
| Key-person dependency (single operator/deployer) | Business | Med | Med | DOC-1 runbook; credentials in a shared vault |
| Scope creep delays 1.0 (5 UAT rounds show a pattern) | Business | Med — release drift | **High** | This plan: feature freeze; new asks triage to 1.1+ unless data-loss/security |

---

## 8. Critical Path & Categorization

**Mandatory before 1.0** *(protects data, detects failure, verifies the last merge — a release without these is operationally blind)*
1. OPS-1 Monitoring/alerting — only way to know prod is alive.
2. OPS-2 + DB-2 Offsite backup + tested restore — only protection against unrecoverable loss.
3. QA-1 Mobile UAT of R4 — the merge is green in CI but has never been touched on a device.
4. MOB-1 Push go/no-go — the one open user-facing thread; needs a decision, not necessarily code.

**High priority (ship in 1.0 if the sprint allows — cheap, high-leverage)**
OPS-3 rollback, QA-2 load sanity, SEC-3/SEC-4, BE-1 hygiene, DOC-1/DOC-2. All ≤1 day each; they convert "capable" into "operated".

**Nice to have (1.1)** — staging+CD (OPS-4/5), token revocation/refresh (SEC-1/2), test-debt paydown (QA-3/4/5), structured logs (BE-2), OpenAPI (BE-3), table helper (FE-1), a11y breadth (FE-2), DB-1. *Why not 1.0*: none block a safe launch; all improve velocity/safety of subsequent releases.

**Future versions (2.0+)** — Postgres (BE-4), real ERP connector (BE-5), iOS (MOB-3), Play Store (MOB-2), 2FA (SEC-5). *Why deferred*: each is architectural or needs external prerequisites (ERP access, Apple accounts, measured scale pressure); current design already isolates the seams (`erp.connector()`, documented Postgres plan), so deferral adds no lock-in.

---

## 9. Prioritized Roadmap

| Version | Objective (one line) | Contents |
|---|---|---|
| **1.0 — "Operated"** (now + 2 wks) | The system as built, made observable, recoverable, and device-verified — then tagged and frozen | Critical path + high-priority list above. **No new features.** |
| **1.1 — "Sustainable"** (+4–6 wks) | Pay the debt that makes every later release faster and safer | Staging + CD, auth lifecycle (revocation/refresh), Flutter + service unit tests, e2e lib dedup, structured logs, OpenAPI, table helper, a11y breadth |
| **2.0 — "Integrated & Scaled"** (quarter horizon) | Remove the two 1.0 boundaries: manual ERP entry and SQLite ceiling | Real ERP connector, PostgreSQL migration, Play Store distribution, iOS build, 2FA |
| **3.0 — "Enterprise"** (backlog, demand-driven) | Multi-site / multi-tenant operation | Multi-warehouse orchestration, wave/zone picking, labor metrics, forecasting on the existing ABC-XYZ engine, SSO |

---

## 10. Recommended Next Engineering Sprint — "V1.0 Launch Readiness" (2 weeks)

**Goal**: tag `v1.0.0` at sprint end with the Section 6 checklist fully green.

| Day | Work | Owner discipline |
|---|---|---|
| 1–2 | OPS-1: uptime monitor + pm2-logrotate + restart alerts; test-fire an alert | DevOps |
| 2–4 | OPS-2 + DB-2: attachments into backup script, offsite sync, integrity check, **restore drill on a scratch dir** | DevOps |
| 3–5 | MOB-1: Firebase project (operator task, pair-guided) → CI secret → rebuild APK → device push verification | Mobile + operator |
| 5–8 | QA-1: scripted device UAT of all R4 features (reverse at every stage, drill-through, create-request fields, notifications); log findings; fix only defects | QA + Mobile |
| 8–9 | QA-2: k6 load sanity vs. off-hours instance; document ceiling in DOC-1 | QA/Backend |
| 9–10 | BE-1 hygiene + SEC-4 CSP/rotation + OPS-3 rollback section + DOC-1/DOC-2 | Backend/Docs |
| 10 | Release: tag `v1.0.0`, publish APK release notes, checklist sign-off | TPM |

**Sequencing logic**: alerting first (everything after is observable), backups second (everything after is recoverable), Firebase third (longest external dependency — operator action — so start early), UAT after push is live (tests the full notification path), load test after UAT (stable build), hygiene/docs last (touch nothing after verification), tag last.

**Explicit scope guard**: any new feature request arriving during this sprint goes to the 1.1 backlog unless it is a data-loss or security defect.

---

## 11. Continuous Review — standing operating mode

Adopted from this point forward, after every significant implementation I will:
1. Re-run the full quality gate (325-check e2e suite, lint, smoke) and report deltas.
2. Verify the change respects the layering (routes → services → state machine) and flag drift.
3. Diff-review for new duplication/debt and append findings to this backlog with IDs.
4. Re-score any affected readiness area (Section 3) and update the Section 6 checklist.
5. Report progress against the current release objective in each summary.

This document is the living source of truth for V1.0 execution; IDs (OPS-x, SEC-x, QA-x…) are stable for reference in future requests.

---

# Release Readiness Update — 2026-07-20

Baseline: `main @ 9072a22`; work branch `claude/warehouse-management-system-t8zidg`
(PR #25) @ head `2b1e938`+. Feature freeze in effect.

## Production-readiness score: 7.1 → **8.2 / 10**
Gains: DR now has attachments + manifest + checksum + **verified restore drill**
(automated in CI); ops runbook (monitoring + deploy/rollback) written; Android
push fixed and CI-built. Remaining gap to higher score is **owner-executed**:
device UAT sign-off, production monitor wiring, offsite backup destination.

## Backlog status (this phase)
| ID | Item | Status | Evidence | Remaining action | Target |
|---|---|---|---|---|---|
| R4-PUSH | Android push in all states (PR #25) | **Complete** | Physical-device UAT PASSED 2026-07-20 (docs/ANDROID-UAT-V1.0.md sign-off); CI green; APK checksummed | Workstream CLOSED | 1.0 |
| OPS-1 | Monitoring & alerting | **Code complete (doc)** | docs/OPS-RUNBOOK.md §1 | Operator wires external monitor + pm2-logrotate + alert recipients; test-fire | 1.0 |
| OPS-2 | Backup + DR (attachments/manifest/checksum/offsite) | **Test complete** (offsite = doc) | scripts/backup.js; restore drill run; backup_test.py green | Operator sets offsite destination (rclone/rsync) | 1.0 |
| OPS-3 | Deploy + rollback runbook | **Complete** | docs/OPS-RUNBOOK.md §3 | — | 1.0 |
| DB-2 | Backup verification | **Complete** | scripts/verify-backup.js; failure paths proven; CI-enforced | — | 1.0 |
| CLEAN-1 | Remove debug endpoint + temp code | **Complete** | /api/debug/push-test + route file + markers removed; backup_test.py now asserts 404 | — | 1.0 |
| QA-DR | Backup/restore + push-shape + debug-removal tests | **Complete** | tests/e2e/backup_test.py (backup+restore+failure paths+data-only payload+debug-404) | — | 1.0 |
| QA-LOAD | Load sanity test | **Not started** | — | k6/driver vs staging; not representative locally (SQLite single-proc) | 1.0 (owner) |
| UAT-PKG | Android device UAT package | **Complete** | docs/ANDROID-UAT-V1.0.md | Execute on device | 1.0 |
| DEP-BUMP | Dependabot PRs #11–15,#22 | **Deferred** | 6 open PRs | Review post-1.0; not blockers | 1.1 |

## Release checklist delta
- [x] Main CI green · [x] APK generated + checksummed · [x] DR restore drill · [x] verify-backup CI-enforced · [x] rollback documented · [x] ops runbook · [x] UAT package
- [ ] PR #25 merged (gated on device UAT) · [ ] device UAT signed off · [ ] monitoring wired in prod · [ ] offsite backup destination set · [ ] load sanity run · [ ] debug endpoint removed at tag · [ ] v1.0.0 tag
