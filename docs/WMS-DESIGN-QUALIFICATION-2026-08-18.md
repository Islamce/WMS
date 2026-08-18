# KYNOX WMS Design Qualification Evidence

**Date:** 2026-08-18
**Candidate branch:** `feat/request-queue-continuity`
**Base:** `main` / `caaf06879c5d342eb6fcffb00b29d0a04bdd59d5`
**Scope:** frontend-only reconciliation of the approved queue-to-inspector continuity behavior.

## Candidate change

The candidate retains the existing request list and request-detail routes, APIs, permission checks, canonical statuses, workflow actions, audit history, ERP/reservation context, line visibility, task evidence, and reversal controls. It adds user-scoped browser `sessionStorage` for request search/status/page/scroll context, an explicit filtered return label, and a visible “Queue context retained” cue on the request inspector. All displayed context is escaped before insertion. No backend, database, migration, dependency, native-addon, authentication, RBAC, SoD, or release-workflow file changed.

## Automated qualification

| Check | Result |
|---|---|
| `node --check public/js/pages/requests.js` | Passed |
| `node --check public/js/pages/requestDetail.js` | Passed |
| `npm run lint` | Passed with the repository’s existing 16 warnings and no errors |
| `npm test` | Passed; all repository suites completed successfully |
| `npm run test:smoke` | Passed: 6 base smoke, 12 browser visibility, and 11 design-foundation checks |
| New filtered queue → inspector → return regression | Passed: context cue, filtered back path, and search restoration |
| Existing warehouse disclosure and picker-task regressions | Passed |
| Existing axe/browser accessibility smoke | Passed |

## Responsive qualification

A saved Playwright viewport script exercised the isolated local candidate at 1440px, 1366px, 1024px, and 430px widths. Home and Request Work Queue had no horizontal overflow at any viewport: `scrollWidth` equaled `innerWidth` in every check. Screenshots and metrics are stored under `artifacts/queue-continuity-responsive-2026-08-18/`, with visual findings in `preview-findings.md`.

The desktop preview retained the light-first operational shell, alert rail, role-focused process grouping, and process-card hierarchy. The mobile preview stacked process cards into touch-sized single-column surfaces without horizontal clipping. This is layout evidence only; it does not substitute for authenticated workflow UAT or physical Android UAT.

## Safety qualification

The candidate diff is restricted to `public/js/pages/requests.js`, `public/js/pages/requestDetail.js`, `public/css/kynox-v2.css`, `tests/smoke/request_line_visibility_browser.js`, and the recovery/qualification documentation. No production access, production database access, migration, Passenger restart, release dispatch, or production environment change was performed during this qualification.

## Decision

The candidate is **qualified for isolated CI review**. It is not yet a production release authorization. Any production deployment must use the existing manual guarded Hostinger workflow, including CI, backup, dependency/native-addon, migration, canonical atomic-switch, restart, rollback, and health gates, followed by post-release functional checks.

**Author:** Manus AI

## Post-release asset verification and correction

The first guarded deployment of the merged candidate completed all release gates and returned a healthy `/healthz`, but cache-busted public asset retrieval initially returned the request-detail asset hash from the older redesign-foundation revision `1753b7f`, not the merged candidate. Read-only Hostinger inspection then confirmed that the active symlink resolved to `gha-32126556457-1` and that the active candidate files matched the merged local candidate hashes. The discrepancy was therefore classified as stale edge/static asset delivery rather than an activation mismatch.

The correction adds a release-scoped HTML marker and cache-busting query parameters to the changed request queue, request detail, and KYNOX V2 stylesheet assets. It does not alter workflow semantics or production data. The correction was rechecked with JavaScript syntax validation, lint (zero errors and the repository’s existing 16 warnings), `npm audit --omit=dev --audit-level=high` (exit 0 with eight known moderate transitive advisories), and `git diff --check`.

The local smoke command was also attempted after the isolated preview account’s forced-password state had been changed during local UAT. Its authenticated checks failed with `401` because the repository smoke credential no longer matched that local-only test database; this is an environment-state limitation, not a production failure. The unchanged candidate’s full CI run `32126056729` had already passed the complete browser smoke gate before deployment. The cache-busting correction must receive a fresh CI browser-smoke pass before any further release retry.
