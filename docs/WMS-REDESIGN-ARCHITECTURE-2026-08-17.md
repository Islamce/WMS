# KYNOX WMS Experience Redesign — Forensic Audit and Target Architecture

**Date:** 2026-08-17  
**Branch:** `feat/wms-experience-redesign-execution`  
**Status:** Working architecture baseline for controlled implementation waves.

## 1. Current-state forensic audit

The current application is already functionally broad and has an emerging V2 presentation layer. The main UX issue is not absence of screens; it is that the operational model is distributed across launchpads, queues, detail views, and role-specific pages. The redesign therefore focuses on continuity, context, and prioritization.

| Surface | Current purpose | Current strengths | Observed UX risk | Proposed treatment |
|---|---|---|---|---|
| Web Home | Permission-filtered process launchpad with role-focused groups and recent notification preview. | Role-aware discovery, permission filtering, search, show-all fallback. | It is still primarily destination discovery; it does not reliably show assigned work or an exception queue. | Keep as role-aware shell entry; add only server-authorized attention/my-work signals where existing contracts support them. |
| Web Command Center | Stock, movement, KPI, exception cards, charts, and drill-through. | Existing command-center direction, action-required cards, route drill-through, graceful KPI absence. | It mixes action queues with broad inventory charts and some signals land on generic queues rather than object-specific filtered work. | Preserve existing APIs and charts; strengthen context, queue continuity, and signal-to-filtered-queue behavior incrementally. |
| Material Requests list | Request queue and navigation to request detail. | Existing filter/search/pagination and workflow status vocabulary. | Context and next action may require opening several separate views; role-specific queue intent is not always foregrounded. | Add explicit queue context, current owner/next action/exception columns where data exists; retain route and API contract. |
| Request detail | Transactional object view with header, ERP context, lines, task evidence, attachments, history, cancel/reverse actions. | Already close to the universal operational object target; preserves ERP/reference, material lines, task evidence, audit, and reversal semantics. | Essential information is divided into sequential cards; current stage/next action is not yet a reusable visual timeline. | Restyle into object header + lifecycle strip + exception banner + context/lines/evidence sections without removing current controls. |
| Approval workbench | Manager approval and modification actions. | Supports approve, partial approve, modify, reject, return, SoD constraints. | Review context can compete with action controls; line-level decision state is dense. | Preserve business actions; introduce clearer decision summary and prominent exception/reason fields. |
| ERP operator queue/detail | Reservation and ERP context entry. | Request-line visibility and mandatory ERP fields already addressed by PR #68/#69. | Queue-to-detail continuity and “what must be completed now” can be improved. | Adopt PR behavior; add contextual header and valid-next-action emphasis. |
| Warehouse execution | Allocation, task visibility, picker assignment, and request-card workspace. | PR #68/#69 preserve request lines, picker identity, reminder/escalation evidence, and role-focused cards. | Multiple screens can still feel like separate modules rather than one execution queue. | Adopt + restructure presentation around a common queue/object/task frame; do not alter task semantics or reassignment rules. |
| Picker web/mobile execution | Assigned tasks, accept/start/scan/quantity/shortage/complete flow. | Guided scan and shortage validation already exist; backend remains authoritative. | Mobile task steps and exception messaging can be made more explicit and less form-like. | Prioritize task identity, current step, required scan, validation state, quantity, and recovery action. |
| Goods Issue | GI-ready queue/detail, posting, ERP error, return-to-picker, reversal. | Strong context, shortage, QR evidence, and error path. | ERP errors and return actions need clearer exception hierarchy and queue return behavior. | Keep controls; standardize exception banner, evidence, and return-to-filtered-queue behavior. |
| Inbound/quality | Receiving, batch, dates, quality, bin assignment, labels, expiry. | Implemented receiving and quality controls with traceability. | Inbound capabilities are distributed across receiving, batch, expiry, quality, and cycle count destinations. | Present as Inbound workspace with progressive disclosure; do not surface unsupported put-away automation. |
| Inventory | Batches, locations, empty locations, physical inventory, cycle count, movement history. | Broad inventory and control coverage, governed counting. | Material/location/batch relationships are not yet a consistent “360” object model. | Build reusable explorer and detail patterns only where existing APIs provide the data. |
| Analytics | KPI, stock analytics, classifications, coverage/evidence semantics. | Deterministic analytical semantics and integrity correction. | Analytics can become detached from operational action. | Add safe drill-through to affected batches/materials/evidence views; preserve `UNKNOWN` and coverage warnings. |
| Administration/master data | Users, permissions, materials, locations, warehouses, movement types, imports, audit. | Permission and audit foundations are strong. | Full-permission navigation can become overly broad. | Keep role-filtered navigation; group configuration separately from operational work. |
| Flutter Home | Role-gated launchpad with drawer, notification badge, settings, and back behavior. | Separate mobile model, role filtering, notifications, safe back behavior. | Home remains a tile catalog rather than a “my work + scan + alerts” frontline surface. | Add role-appropriate work summary only from existing authorized data; keep drawer secondary. |
| Flutter task screens | Request, ERP, warehouse, picking, GI, receiving, quality, inventory, shipping, scan. | Strong parity and guided picking/scan foundation. | Some flows can require navigation between screens instead of a single guided task. | Incrementally add task step framing and explicit scan/exception states without desktop-sidebar replication. |

## 2. Canonical outbound workflow architecture

The repository’s canonical statuses remain authoritative. The display model below is a projection, not a new persisted state machine.

| Display phase | Canonical examples | Primary actor | Required context | Primary next action | Exception treatment |
|---|---|---|---|---|---|
| Request | Draft, Submitted, Pending Manager Approval, Under Review, Returned to Requester | Requester / Manager | Requester, department, priority, need date, lines | Submit or decide | Return/reject/on-hold are explicit non-success outcomes. |
| Approval outcome | Approved, Rejected, Returned to Requester, On Hold | Manager | Line approvals, reason, SoD evidence | Approve/partial/modify/reject/return | Rejected/returned/on-hold shown as exception or decision outcome. |
| ERP readiness | Approved - Pending ERP Processing, Pending ERP Reservation, ERP Reservation Created, Movement Type Assigned | ERP operator | Reservation/reference, movement type, plant, SLoc, issue warehouse | Validate and continue | ERP error/on-hold is visible and actionable. |
| Warehouse preparation | Warehouse Assigned, Pending Warehouse Action, Pending Bin Location Assignment, Location Assigned, Batch Assigned | Warehouse manager / supervisor | Warehouse, bin, batch, FIFO/FEFO, quality, expiry, reservation | Allocate and assign | Allocation failure, blocked/expired/quality issues are exception banners. |
| Picker handoff | Pending Picker Assignment, Assigned to Picker, Pending Picker Acceptance, Reminder Sent, Escalated to Supervisor, Accepted by Picker | Supervisor / picker | Picker identity, task age, reminder/escalation evidence | Assign, accept, remind, reassign only when allowed | Reminder/escalation are attention states, not successful completion. |
| Picking | Picking in Progress, Picking Completed, Partially Picked | Picker | Material, batch/bin, approved/picked, scan state, shortage reason | Scan, confirm, complete | Wrong scan, expired, quality hold, shortage, network error each have recovery. |
| GI | Pending ERP GI, GI Posted, ERP Error | Warehouse operator / ERP boundary | Picked lines, shortage, QR evidence, GI fields | Post, retry, return to picker | ERP error and return-to-picker remain explicit. |
| Outcome | Completed, Partially Completed, Closed with Shortage, Reversed, Cancelled | Warehouse / supervisor | GI document, final quantities, audit history | Review/reverse where authorized | Partial, shortage, reversal, and cancellation are not styled as ordinary success. |

## 3. Proposed desktop information architecture

The target groups are validated against the implemented route inventory and preserve existing route identifiers and permission keys.

| Primary area | Child destinations / workspaces | Existing route treatment |
|---|---|---|
| Command Center | Operations overview, KPI, notifications, AI analytics | Reuse `dashboard`, `kpi`, `notifications`, `ai`; keep role visibility. |
| Requests & Outbound | Create request, requests, approvals, ERP processing, GI, shipping | Group existing `create-request`, `requests`, `approvals`, `erp-operator`, `gi-posting`, `shipping`. |
| Inbound & Quality | Goods receipt, quality, batch/expiry, QR labels | Group existing `receiving`, `quality`, `batches`, `expiry`, `qr-printing`. |
| Warehouse Execution | Execution queue, allocation, picker assignment, my tasks, reallocation | Group existing `warehouse`, `allocation`, `picker-assign`, `picking`, `reallocation`. |
| Inventory Control | Stock explorer, locations/bins, physical inventory, cycle count, movements | Group existing inventory/location/count routes; do not fabricate unsupported Material 360 data. |
| Exceptions & Tasks | Cross-process attention views and authorized filtered queues | Prefer existing queues and notification/audit routes; introduce a dedicated route only if the data contract is proven sufficient. |
| Intelligence | KPI, stock analytics, evidence/coverage | Keep analytical semantics and drill-through boundaries. |
| Master Data | Materials, warehouses, locations, bins, movement types, import | Existing master routes grouped by operator intent. |
| Administration | Users, permissions, audit, settings/integrations where implemented | Existing admin routes; role-filtered and separated from execution. |

The full-permission navigation target is approximately 8–9 primary areas, while the existing route and permission model remains authoritative. Workers see only role-relevant areas and their primary queue first.

## 4. Proposed mobile information architecture

Flutter remains a distinct frontline product with four primary jobs: **Home**, **My Tasks**, **Scan**, and **Alerts**, with role-appropriate operational destinations behind them. The current launchpad and drawer are retained as compatibility surfaces but progressively reoriented so that pickers and supervisors see work before administration or analytics.

| Mobile surface | Picker emphasis | Supervisor emphasis | Implementation boundary |
|---|---|---|---|
| Home | Current assignment, next task, scan shortcut, urgent alerts | Unassigned work, active pickers, escalations, shortage attention | Use existing authorized endpoints; no invented metrics. |
| My Tasks | Assigned task list and guided task detail | Assignment and escalation queue | Reuse picking/warehouse APIs and preserve task transitions. |
| Scan | QR/barcode entry and validation feedback | Scan shortcut from task/object | Backend validation stays authoritative. |
| Alerts | Actionable notification and exception list | Escalations, blocked work, shortages | Do not turn every notification into an exception. |
| Operations | Only role-relevant operational screens | Queue and monitoring screens | Keep existing permissions and deep-link behavior. |

## 5. Role experience matrix

| Role family | Home priority | Key queue | Primary object actions | Hidden/secondary areas | Mobile posture |
|---|---|---|---|---|---|
| Requester | My requests and create request | Request tracking | Create, submit, view, cancel where allowed | Admin, allocation, GI, analytics | Create/track; not execution-heavy. |
| Manager/approver | Attention and approvals | Approval workbench | Approve, partial, modify, reject, return | Master/admin | Review-first, context-rich. |
| ERP operator | ERP queue and errors | Reservation queue | Enter/validate ERP context, retry/hold | Picker controls, admin | Queue/detail form with reversal support. |
| Warehouse manager | Command Center and workload | Warehouse execution | Allocate, monitor, assign, reassign when allowed | User administration | Monitor and intervene. |
| Supervisor | Escalations and assignment | Picker assignment | Remind, escalate, assign/reassign per rules | Broad analytics/admin | Workload and exception-first. |
| Picker | My Tasks and Scan | Assigned picking tasks | Accept, start, scan, confirm, shortage, complete | Admin, master data | Minimal-step guided execution. |
| Warehouse operator | GI-ready work | Goods Issue queue | Validate, post GI, return to picker, resolve ERP error | Admin | Action and evidence-first. |
| Quality/inventory controller | Holds, expiry, counts | Quality/count queues | Release/block/reject, count, approve variance | Request creation | Detail and evidence-first. |
| Auditor/admin | Governance signals | Audit/users/permissions | Review/configure within permission | Frontline tasks secondary | Review and administration. |

## 6. Wireframe-level screen specifications

| Screen | Required hierarchy | Must preserve |
|---|---|---|
| Command Center | Context bar → attention → my work → process pulse → decision KPIs → recent activity | Existing dashboard/KPI APIs and drill-through permissions. |
| Request list | Page header → queue filters → dense table → saved context/position | Search, pagination, status, priority, warehouse, route. |
| Request detail | Object header → display lifecycle → exception banner → primary next action → execution context → lines → evidence/history | ERP fields, line quantities, batch/bin, task evidence, audit, reversal. |
| Approval | Request context → line decisions → decision summary → valid actions | SoD, partial approval, modification, return/reject semantics. |
| ERP | Queue → request context → reservation form → validation result → next action | Mandatory fields, ERP error/on-hold, reversal. |
| Warehouse queue | Workload context → filters → request cards/table → task evidence | FIFO/FEFO, allocation, picker identity, reminders/escalation. |
| Picker task | Task identity → current step → scan/validation → quantity → exception/recovery → complete | All backend scan/quantity/shortage validation. |
| GI | Ready queue → picked/short lines → ERP context → posting action → result | Idempotency, ERP error, return-to-picker, reversal. |
| Inventory | Overview → explorer → object detail | Stock/reserved/available, batch/bin/location, quality/expiry, provenance. |
| Exception center | Severity → process → object → owner → age → cause/evidence → action | Only semantically justified exceptions. |
| Flutter home/task/scan | Current work → next action → scan/validation → exception → confirmation | Mobile permissions, QR, session, safe back, offline/network messaging where supported. |

## 7. Design decisions register

| ID | Problem | Evidence | Decision | Alternatives | Reason | Impact | Status |
|---|---|---|---|---|---|---|---|
| IA-001 | Full-permission navigation exposes too many implementation-oriented destinations. | `public/js/app.js` route/module model and existing V2 navigation work. | Organize by operator intent into 8–9 primary areas while preserving route identifiers and permissions. | Rewrite route model; keep existing groups. | Reduces cognitive load without breaking bookmarks/contracts. | Shell and labels only initially. | PROPOSED |
| UX-001 | Home is a launchpad and notification preview, not a full operational prioritization surface. | `home.js` explicitly says it does not aggregate action queues. | Add only authorized attention/my-work projections with safe fallbacks; do not call every queue from Home. | Make Home a chart wall; leave unchanged. | Matches the operating model and performance constraint. | Command Center/Home presentation. | PROPOSED |
| FLOW-001 | Canonical workflow has many internal statuses and exception states. | `server/workflow/states.js`. | Use a display lifecycle projection plus canonical status detail; exceptions remain explicit. | Replace statuses with simplified labels. | Preserves business semantics and auditability. | Shared timeline/status components. | PROPOSED |
| UX-002 | Request detail already contains most required operational context but is card-separated. | `requestDetail.js` and `workflowContext.js`. | Restyle into a universal operational object layout without removing fields/actions. | Create separate object pages. | Avoids duplication and context loss. | Request detail and downstream screens. | PROPOSED |
| MOB-001 | Flutter launchpad is parity-oriented rather than task-oriented. | `home_screen.dart`. | Reorient mobile Home around My Tasks/Scan/Alerts while retaining the current drawer and permissions. | Copy desktop IA; replace all navigation. | Mobile work is frontline and route compatibility matters. | Flutter shell/home. | PROPOSED |
| DATA-001 | Analytics must not overstate evidence or invent actions. | Current status and analytics-integrity correction docs. | Preserve `UNKNOWN`, coverage warnings, and provenance; add only safe drill-through. | Add recommendations regardless of coverage. | Protects analytical trust. | Analytics surfaces only. | PROPOSED |
| PR-001 | PR #68/#69 contain validated context and navigation work. | Open PR metadata and branch ancestry. | Extend the complete #68 → #69 stack; do not reconstruct from main. | Start from main; include unrelated PRs. | Lowest duplication and conflict risk. | Branch lineage and review scope. | DECIDED |

## 8. Residual risks and unknowns

| Risk / unknown | Classification | Mitigation |
|---|---|---|
| Some desired Command Center “my work” counts may not exist in one authorized aggregation contract. | UNKNOWN | Prove data availability before adding API; use existing queue links/fallbacks first. |
| Existing routes such as stock-in/stock-out and some master screens may be legacy or permission-specific. | UNKNOWN | Confirm route reachability and page registration during implementation tests before moving labels. |
| Local dependencies are absent in the clean worktree; runtime test suites are not yet executed here. | VERIFIED | Install only non-production local dependencies if safe, then run and report exact results; otherwise mark NOT EXECUTED. |
| Visual correctness across browser widths and Flutter devices is not proven by source inspection. | UNKNOWN | Generate browser screenshots and run responsive/accessibility checks in later waves. |

## References

1. [KYNOX WMS V2 transformation plan](https://github.com/Islamce/WMS/blob/main/docs/KYNOX-WMS-V2-TRANSFORMATION-PLAN.md)
2. [Canonical workflow states](https://github.com/Islamce/WMS/blob/main/server/workflow/states.js)
3. [Workflow context service](https://github.com/Islamce/WMS/blob/main/server/services/workflowContext.js)
4. [Oracle WMS task management](https://docs.oracle.com/cd/E26401_01/doc.122/e48830/T211976T430466.htm)
5. [Manhattan Active Warehouse Management](https://www.manh.com/solutions/supply-chain-management-software/warehouse-management)
6. [Blue Yonder Warehouse Management](https://blueyonder.com/solutions/warehouse-management)
7. [Microsoft Dynamics 365 Warehouse Management mobile app](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/install-configure-warehouse-management-app)
8. [Odoo 19 inventory management](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management.html)

**Author:** Manus AI
