# KYNOX WMS Experience Redesign — Repository Baseline

**Date:** 2026-08-17  
**Repository:** `Islamce/WMS`  
**Execution branch:** `feat/wms-experience-redesign-execution`  
**Evidence policy:** Findings below distinguish repository facts from interpretation and proposed action.

## Executive baseline

The repository is a production-controlled, three-surface WMS rather than a greenfield product. The current `main` branch is `22b4a16` and contains the merged workflow-context and analytics-integrity correction. The web frontend is a vanilla-JavaScript SPA with a permission-gated hierarchical shell, an existing KYNOX V2 visual layer, role-aware navigation enhancements, and a broad route inventory. The Flutter application contains the primary warehouse workflows and a separate mobile navigation model.

The canonical Material Request lifecycle is defined in `server/workflow/states.js`. It includes materially more detail than a simple progress bar, including approval, ERP reservation, movement and warehouse assignment, bin/batch allocation, picker acceptance, reminders, escalation, picking, ERP GI, completion variants, ERP errors, on-hold, cancellation, and reversal. Any redesign must therefore create a simpler display lifecycle only as a projection of these canonical states, never as a replacement.

## Repository truth

| Area | Verified observation | Redesign consequence |
|---|---|---|
| Branch state | `main` is clean at `22b4a16`; redesign work is now isolated on a feature branch based on the complete PR #68 → #69 stack. | Do not develop directly on `main`; preserve the existing stack while extending it. |
| Web shell | `public/js/app.js` defines the permission-gated route/module model, breadcrumbs, command palette, theme controls, and shell behavior. `public/js/navigation-v2.js` adds role-focused grouping and terminology. | Reuse the shell and route contracts; do not create a second navigation system. |
| Existing V2 work | PR #69 adds role-focused request cards, workspace navigation, and a design foundation on top of PR #68. | Extend this stack instead of reconstructing the approved work from `main`. |
| Backend workflow | `server/workflow/states.js` is the canonical status and transition source. | UI labels and timelines must map to canonical states and preserve exception semantics. |
| Web operational surfaces | Pages exist for Home, Dashboard, requests, approvals, ERP, warehouse, allocation, picker assignment, picking, GI, shipping, receiving, quality, inventory, master data, import, analytics, and administration. | Consolidate discoverability and context, not capability. |
| Mobile surface | Flutter includes role-aware Home, requests, approvals, picking, scanning, receiving, inventory, reallocation, GI, shipping, quality, analytics, notifications, and administration-related screens. | Treat mobile as a frontline execution product, not a desktop sidebar port. |
| Data/API boundary | Existing workflow APIs and permission keys support the current operations; the brief prohibits weakening RBAC, SoD, audit, or workflow semantics. | Prefer read-model composition and presentation changes; avoid schema/API changes unless a verified gap requires them. |
| Test boundary | The repository has e2e, smoke, accessibility, lint, navigation, and Flutter CI artifacts. Local runtime evidence must be reported accurately and not inferred from static inspection. | Add focused regression coverage for every redesigned behavior and preserve existing gates. |

## Open-PR reconciliation matrix

| Existing work | Branch / PR | Purpose | Keep | Adapt | Supersede | Conflict | Dependency |
|---|---|---|---|---|---|---|---|
| Request-line visibility and picker-state consistency | `fix/request-line-visibility-picker-state` / PR #68 | Adds request-line visibility in ERP and Warehouse Dashboard, preserves picker identity through reminder/escalation, and adds regression coverage. | Read-only line context, lazy expansion, task evidence, explicit Reassign, and tests. | Integrate into universal object/queue layouts without changing the API or permission boundary. | None. | None identified; all behavior is within the redesign’s context-preservation goal. | Base layer for PR #69. |
| Role-focused request cards and workspace navigation | `feat/d02-execution-cards` / PR #69 | Extends #68 with role-focused request cards, Home/process discovery, navigation/workspace presentation, and design-foundation smoke coverage. | Role-focused home, request cards, process discovery, navigation foundation, and tests. | Extend from role-focused presentation into Command Center → queue → object → action continuity and responsive/mobile parity. | None. | Must avoid converting request cards into decorative dashboards or hiding dense queue data. | Depends on #68; selected as implementation base. |
| Analytical scope attestations | `fix/cor002-scope-attestation` / PR #67 | Adds governed analytical attestation records and permissions. | Preserve untouched; unrelated to the initial UX redesign. | Only adapt if the audit reveals a presentation need for attestation evidence. | None. | Do not combine unrelated analytics governance changes. | Independent open PR; not included in base. |
| Lean agent context governance | `chore/lean-context-drift-control` / PR #59 | Documentation-only task-scoped context and drift guidance. | Treat as project governance context. | No application changes required. | None. | None. | Independent open PR; not included in base. |

## Base decision

**Selected option:** create a successor redesign branch from the complete `feat/d02-execution-cards` tip, which already contains the PR #68 stack.

This is the lowest-duplication and lowest-conflict option because PR #69 explicitly depends on PR #68, both are still open, and the branch tip contains the role-focused presentation work that the attached program asks to extend. Starting from `main` would require reconstructing approved request-line, picker-state, navigation, and design-foundation changes. Including PR #67 or PR #59 would combine unrelated work and increase review surface. The branch remains reversible and does not merge or deploy anything.

## Initial constraints for implementation

The redesign is presentation- and workflow-context-led. It must preserve route identifiers, permission keys, API contracts, canonical statuses, transaction behavior, SoD, audit history, ERP/reference semantics, allocation rules, scan validation, quantity/shortage controls, notifications, analytics provenance, and mobile deep-link behavior. Unsupported processes must remain marked as not present or planned rather than being surfaced as active features.

## Next audit focus

The next step is the screen-by-screen and workflow-transition audit: enumerate the actual route/module/page surfaces on web and Flutter, map the canonical outbound lifecycle and other implemented domains, record context loss or duplication, and compare the existing V2 foundation against the attached target operating model before changing application code.

## References

1. [Repository `Islamce/WMS`](https://github.com/Islamce/WMS)
2. [PR #68 — request-line visibility and picker-state consistency](https://github.com/Islamce/WMS/pull/68)
3. [PR #69 — role-focused request cards and workspace navigation](https://github.com/Islamce/WMS/pull/69)
4. [PR #67 — analytical scope attestations](https://github.com/Islamce/WMS/pull/67)
5. [PR #59 — lean agent context governance](https://github.com/Islamce/WMS/pull/59)
6. [KYNOX WMS V2 transformation plan](https://github.com/Islamce/WMS/blob/main/docs/KYNOX-WMS-V2-TRANSFORMATION-PLAN.md)
7. [Canonical workflow-state definitions](https://github.com/Islamce/WMS/blob/main/server/workflow/states.js)

**Author:** Manus AI

> This document records repository and GitHub observations for the redesign branch. It does not assert production state, deployment state, or approval to merge.

