# KYNOX Pulse Functional UAT Slice Contract

## Purpose

This isolated UAT slice proves the interaction model for **Command Palette navigation** and **queue-to-inspector state continuity**. It is not a production implementation, does not call KYNOX APIs, stores no data, and must not make workflow, inventory, ERP, permission, or audit-log changes.

## Synthetic authorization boundary

The preview uses the explicit synthetic context **`UAT role: Shift Lead`**. The palette exposes only safe navigation and view-changing capabilities represented by the demo dataset:

| Capability | UAT behavior | Persistent side effect |
|---|---|---|
| Find a material request | Matches visible synthetic queue objects by ID, work signal, owner, or source context; selecting a result filters and opens the object in the inspector. | None |
| Open priority queue | Clears transient query state and returns to the first available synthetic object. | None |
| Open exception center | Applies the synthetic `ERP error` filter and opens the sole matching object. | None |
| Review shift handover | Opens the synthetic handover panel. | None |
| Create request | Not included as an executable Command Palette result in this slice. | None |

## Filter-to-inspector continuity contract

| Filter outcome | Required inspector behavior |
|---|---|
| Existing selection remains visible | Preserve the selected object and inspector context. |
| Exactly one row remains visible | Automatically select that row and explain the active filter. |
| More than one row remains and selection is hidden | Clear the inspector and prompt the user to select from the visible results. |
| No rows remain | Clear the inspector, show a no-results state, and provide a one-action filter reset. |
| User clears a filter | Restore the full synthetic queue and select the first visible row when none is selected. |

## Command Palette keyboard contract

The palette opens from the visible button or `Ctrl/Cmd + K`. It supports typing, Arrow Up/Down result movement, Enter selection, and Escape dismissal. A request result deep-links into the same queue and contextual inspector while preserving the applied query as visible filter state.

## Acceptance checks

1. Searching `MR-00119` shows a request result; pressing Enter filters to and opens `MR-00119` in the inspector.
2. Searching `ERP` shows the ERP-error request result and the exception-center navigation result.
3. Selecting **Open exception center** produces a visible `ERP error` filter state and selects the matching request.
4. Filtering `ERP error` cannot leave `MR-00124` selected in the inspector.
5. A no-result filter displays a no-results message, an empty inspector, and a clear-filter control.
6. No UAT interaction persists data or calls the WMS.

**Author:** Manus AI
