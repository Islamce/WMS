# KYNOX Pulse Functional UAT Slice — Test Evidence

**Date:** 2026-08-17

**Environment:** Isolated static UAT preview at the temporary review URL.

**Data boundary:** Synthetic only. No WMS API, database, ERP, inventory, workflow, permission, or audit-log integration.

## Verification results

| ID | Acceptance check | Result | Evidence |
|---|---|---|---|
| F-01 | Command Palette can open from the visible global control. | **Passed** | Palette opened with navigation actions and the five synthetic work objects. |
| F-02 | `Ctrl/Cmd + K` opens the palette. | **Passed** | Keyboard shortcut opened the palette from the restored queue state. |
| F-03 | Searching `MR-00119` returns one matching object. | **Passed** | The palette reduced to `MR-00119 — ERP posting error · ERP Desk`. |
| F-04 | Enter activates a selected request result. | **Passed** | Enter closed the palette, applied visible `MR-00119` filtering, and selected `MR-00119` in the inspector. |
| F-05 | Multiple results support keyboard traversal. | **Passed** | `ERP` returned the exception-center navigation action and `MR-00119`; Arrow Down moved active selection from the navigation action to the request result. |
| F-06 | Selecting the keyboard-highlighted request updates the inspector. | **Passed** | Enter on the selected `MR-00119` result displayed ERP-error status, rationale, decision trail, and `Resolve` next action. |
| F-07 | A one-result queue filter cannot leave stale inspector context. | **Passed** | `MR-00119` produced one visible work row and selected that object in the inspector. |
| F-08 | A zero-result filter shows safe recovery and clears stale inspector state. | **Passed** | `ZZZ-NO-MATCH` produced no results, an explicit no-results message, a clear-filter action, and a `No work selected` inspector. |
| F-09 | Clearing a no-result filter restores a coherent queue and selection. | **Passed** | Clear filter restored five synthetic rows and selected `MR-00124`. |
| F-10 | Browser console remains clean after the key deep-link interaction. | **Passed** | No console output was reported after the keyboard deep-link test. |

## Functional scope delivered

The Command Palette now searches the allowed synthetic work dataset by request ID, work signal, owner, and request context. It offers safe navigation entries, query-result count feedback, Arrow Up/Down traversal, Enter activation, Escape dismissal, and a non-persistent deep-link into the shared queue and contextual inspector.

The queue now exposes filter count and active-query context. When one result remains, it automatically selects that object. When the selected object becomes hidden by a multi-result filter, the inspector becomes an explicit selection prompt. When no result remains, the inspector is cleared and the queue offers a recovery action. No hidden or stale object remains presented as the active work item.

## Explicit exclusions

This UAT slice intentionally does not execute WMS actions. It does not implement real authorization checks, server-side search, persistent saved views, backend object routing, audit events, ERP retries, inventory mutation, mobile scanning, or mobile exception recovery. Those must be implemented against the real application contracts and validated with role-based UAT before any production rollout.

**Author:** Manus AI
