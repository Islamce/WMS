# KYNOX Pulse UAT Visual QA

**Desktop:** The workbench renders as intended: a light mineral canvas, slim icon rail, compact command strip, single risk rail, dominant priority queue, and persistent contextual inspector. The visual hierarchy is substantially calmer and more current than the earlier dark card-first concept.

**Mobile:** The adaptive surface correctly presents a single active pick, step progression, bin-scan affordance, quantity/batch context, online state, and bottom navigation. A release-blocking presentation issue was found: the sticky primary action overlaps part of the recovery copy. The action zone will be converted to normal document flow so the recovery guidance remains fully visible above the fixed mobile navigation.

**Final verification:** The refreshed UAT page was loaded successfully at the public preview URL. The desktop queue-and-inspector composition is visible, and selecting `MR-00119` updated the inspector identity, status, action label, lifecycle context, and action button from the initially selected request. The primary UAT action intentionally displays a non-persistent preview notice. The final mobile layout correction removes the fixed-navigation overlap pattern from the showcase.

## Second enhancement wave

**Desktop:** The advanced workbench now has clear three-tier hierarchy: shift continuity and workload signals, change awareness, then the actionable priority queue and contextual inspector. The handover, workload pacing, and “why this is in your queue” elements give operational context without returning to a heavy dashboard-card pattern.

**Mobile:** The scan-first active-pick surface now includes explicit shift carryover context, online state, step progress, bin/quantity/batch context, recovery guidance, action-first controls, and product-level navigation. All visible task content and actions remain unobscured.

**Interactive verification:** The public UAT page loaded with all second-wave desktop surfaces. Selecting a work row is supported by the existing inspector interaction. The global Command control opened a focused command palette showing navigation and quick-action entries, including priority queue, request search, exception center, create request, and shift handover. These preview controls are intentionally non-persistent.

## Functional UAT slice baseline

The temporary UAT server was restarted after the prior static-preview process was no longer listening. The existing public preview URL then loaded the refreshed isolated prototype successfully. On initial load, the queue displayed five synthetic work items and the inspector correctly displayed the selected `MR-00124` context. No production endpoints or live data sources were used.

**Command Palette search check:** Opening the palette showed safe navigation entries plus all five synthetic queue objects. Typing `MR-00119` reduced the palette to one matching result, `MR-00119 — ERP posting error · ERP Desk`, with the result indicated as the active keyboard option.
**Functional deep-link and continuity checks:** Pressing Enter on the sole `MR-00119` Command Palette result closed the palette, applied a visible `MR-00119` queue filter, reduced the queue to one row, and updated the inspector to `MR-00119` with its ERP-error rationale and `Resolve` action. Entering `ZZZ-NO-MATCH` then produced zero queue results, an explicit no-results message, a clear-filter control, and a cleared inspector rather than stale request context.
**Recovery and keyboard checks:** Clearing the no-result filter restored all five synthetic queue rows and selected `MR-00124` in the inspector, restoring a coherent default state. The documented `Ctrl/Cmd + K` shortcut also opened the Command Palette from the queue without requiring pointer navigation.
**Keyboard traversal check:** With the query `ERP`, the palette returned both the safe **Open exception center** navigation action and the `MR-00119` synthetic-work result. Arrow Down moved the active keyboard highlight from the navigation action to the request result, confirming result traversal before activation.
