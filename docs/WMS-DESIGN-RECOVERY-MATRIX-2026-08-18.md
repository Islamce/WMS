# KYNOX WMS Design Recovery Matrix

**Date:** 2026-08-18
**Repository:** `Islamce/WMS`
**Comparison base:** current `main` at `caaf06879c5d342eb6fcffb00b29d0a04bdd59d5`
**Approved design source:** `feat/wms-experience-redesign-execution` at `989c6cf`
**Production application baseline:** deployed SHA `87271334e22a3cbdf3579757b1489e74d5d499d7`, release run `32027249672`
**Scope:** recovery and controlled frontend integration only; no production mutation or deployment is authorized by this matrix.

## Executive finding

The approved KYNOX Pulse direction is **not absent** from the repository. It exists in three layers. First, the current `main` already contains the production-backed V2 shell, role-focused navigation, command-center dashboard, workflow-context projections, request-card presentation, operational object header, and responsive design foundation. Second, the approved redesign branch contains the validated design-foundation lineage and the isolated functional preview slice. Third, `design-preview/` contains the newest interaction contract for command palette search, queue filtering, inspector continuity, no-result recovery, and a mobile active-task surface, but it is synthetic and not a production implementation.

The safe integration strategy is therefore **reconciliation rather than wholesale merge**. Retain current `main` as the production-safety base, reuse the approved design behavior as a contract, and port only frontend behavior that can be implemented against existing route, API, permission, workflow, audit, ERP, allocation, scan, and mobile contracts. The current isolated feature branch adds the first such slice: persisted, user-scoped request-queue context with an explicit filtered return path from the request inspector. It does not add a backend state, change a permission, or alter a workflow transition.

## Recovery matrix

| Design capability | Existing implementation location | Current main | Functional? | Action |
|---|---|---:|---:|---|
| Global shell/navigation | `public/js/app.js`, `public/js/navigation-v2.js`, `public/css/kynox-v2.css`; lineage includes `93e54b8` and `51a902f` | Yes | Yes | Retain the existing route and permission model. Continue presentation-only grouping and cache-aware asset delivery. |
| Operations dashboard / Command Center | `public/js/pages/dashboard.js`; command-center lineage includes `bdbdd6d`, `bc1b0cc`, `c46e6d0`; current dashboard uses existing `/api/dashboard` and optional KPI data | Yes | Yes | Retain production-backed cards, charts, exception drill-through, and graceful unavailable-data behavior. Improve queue continuity only where an existing queue contract is available. |
| Material Request workspace | `public/js/pages/requests.js`, `public/js/ui.js`, request-card lineage `3dbb0eab` | Yes | Yes, with continuity gap | Retain filters, search, pagination, status vocabulary, and route identifiers. Integrate the isolated queue-context persistence and return cue after regression evidence. |
| Request detail inspector | `public/js/pages/requestDetail.js`, `public/js/ui.js` `operationalObjectHeader()`, `requestStageIndicator()` | Yes | Yes, with continuity gap | Retain ERP/reference fields, material lines, task evidence, attachments, audit history, cancel/reverse actions, and server authority. Add only visible queue-context continuity. |
| Reservation context | `server/services/workflowContext.js`, request/ERP/warehouse/picker/GI APIs and pages; validated in the PR #68 → #69 lineage | Yes | Yes | Retain the canonical context projection. Do not invent reservation or ERP timestamps, fields, or recovery actions. |
| Picking workflow | `public/js/pages/picking.js`, `public/js/ui.js`, Flutter picking screens, `server/routes/picking.js` and services | Yes | Yes | Preserve accept/start/scan/quantity/shortage/complete semantics, scan validation, admin bypass audit, and task transition authority. Apply only task-step framing or exception presentation in later waves. |
| Goods Issue workflow | `public/js/pages/giPosting.js`, `server/routes/gi.js`, GI services, Flutter GI screens | Yes | Yes | Preserve idempotent posting, ERP error, return-to-picker, reversal, QR evidence, and audit behavior. Standardize visual exception hierarchy only after a dedicated test slice. |
| Command/search palette | `public/js/app.js` current shell behavior; newer contract and implementation in `design-preview/index.html`, `design-preview/UAT-FUNCTIONAL-SLICE-CONTRACT.md`, evidence in `UAT-FUNCTIONAL-SLICE-TEST-EVIDENCE.md` | Partial | Main shell functional; preview contract fully exercised | Retain current permitted-screen discovery. Reconcile request/material/context search only through existing authorized APIs; do not copy synthetic result objects or expose unauthorized destinations. |
| Queue-to-inspector continuity | Synthetic proof in `design-preview/index.html`; isolated implementation in current branch `public/js/pages/requests.js`, `public/js/pages/requestDetail.js`, `public/css/kynox-v2.css`, regression in `tests/smoke/request_line_visibility_browser.js` | No in current main; isolated branch change present | Focused browser regression passes locally | Validate and submit the isolated frontend slice. No backend or route change is required. |
| Analytics context | `public/js/pages/ai.js`, `public/js/pages/kpi.js`, `server/services/analytics.js`, coverage semantics in decision and integrity documents | Yes | Yes, subject to evidence coverage | Preserve `UNKNOWN`, coverage warnings, provenance, and safe drill-through. Do not convert missing evidence into operational certainty. |
| Responsive web UI | Shared stylesheet and responsive page styles in `public/css/`; browser smoke and design-foundation smoke | Yes | Partially proven by existing smoke; full matrix pending | Qualify at 1440, 1366, 1024, and approximately 430px. Avoid shrinking dense tables without progressive disclosure or intentional scroll semantics. |
| Flutter alignment | Flutter application directory, mobile UAT guide, API/session/scanner/task screens | Yes | Existing parity and physical UAT recorded; new Pulse shell not production-integrated | Retain the distinct frontline mobile model. Implement mobile Home/My Tasks/Scan/Alerts improvements only against existing authorized endpoints and in a separate wave. |
| Synthetic UAT preview | `design-preview/index.html`, contract, visual QA notes, UAT test evidence | No, intentionally isolated | Yes for synthetic interaction contract | Use as behavioral reference and preview asset. Never treat synthetic data or preview authorization as production capability. |

## Branch and commit reconciliation

| Source | Evidence | Decision |
|---|---|---|
| Current `main` | `caaf068` documentation merge atop deployed application lineage | Use as safety and production baseline. |
| `feat/wms-experience-redesign-execution` | `989c6cf`, with prior redesign commits `1753b7f`, `51a902f`, `3db0eab`, and `fae3c12` | Reuse approved frontend behavior and documentation; do not merge wholesale. |
| `feat/kynox-command-center` | `9c19609`, with command-center implementation lineage | Treat as historical source because command-center behavior is already represented on current main. |
| `feat/kynox-wms-v2-navigation-theme` | `93e54b8` | Treat as historical source because the V2 shell/theme is already represented on current main. |
| `design-preview/` | Synthetic UAT contract and 10-check evidence | Keep isolated; use as interaction reference and preview only. |
| Open PRs #59 and #67 | Unrelated governance/analytical work | Keep out of this redesign release unless separately approved and reconciled. |

## Control boundaries

The recovered design does not authorize changes to SQLite persistence, migrations, authentication, JWT handling, RBAC, SoD, audit triggers, ERP connector semantics, inventory transactions, FIFO/FEFO allocation, scan validation, shortage rules, native dependencies, Hostinger runtime architecture, backups, or guarded release controls. Any future backend change must support a proven existing UI capability and include a regression test.

The current queue-continuity slice is presentation-only. It stores filter, page, and scroll context in user-scoped browser `sessionStorage`, escapes all displayed values, retains the existing `#/requests` and `#/request-detail/:id` routes, and does not infer workflow state or bypass server authorization.

## Next controlled action

Complete the focused browser and full-suite qualification for the queue-continuity slice, produce a candidate preview at the supported viewport matrix, submit the isolated branch to CI, and stop before production deployment until the candidate is explicitly reviewed against the guarded release gates.

## References

1. [KYNOX WMS redesign baseline](WMS-REDESIGN-BASELINE-2026-08-17.md)
2. [KYNOX WMS redesign architecture](WMS-REDESIGN-ARCHITECTURE-2026-08-17.md)
3. [KYNOX Pulse functional UAT contract](../design-preview/UAT-FUNCTIONAL-SLICE-CONTRACT.md)
4. [KYNOX Pulse UAT evidence](../design-preview/UAT-FUNCTIONAL-SLICE-TEST-EVIDENCE.md)
5. [Current production status](WMS-CURRENT-STATUS.md)
6. [Production runbook](WMS-PRODUCTION-RUNBOOK.md)

**Author:** Manus AI
