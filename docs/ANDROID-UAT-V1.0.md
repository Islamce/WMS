# WMS V1.0 — Android Device UAT Checklist

Physical-device acceptance tests for the release APK (`app-arm64-v8a-release.apk`
or universal `app-release.apk`). Run against production (`https://wms.kynox.io`)
with the server's Firebase service account configured. Record **Actual result**,
**Pass/Fail**, **Evidence** (screenshot/log ref) and a **Defect ID** for every row.

**Build under test:** version ______ · APK SHA-256 ______ · commit ______
**Device:** model ______ · Android version ______ · Tester ______ · Date ______

Log reading during push tests: `adb logcat | grep "\[push\]"` (token length only,
never the full token; no payload dump).

## A. Core app & workflow

| # | Area | Role | Preconditions | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Login | any | valid creds | Enter email/pw → sign in | Home/launchpad loads; token stored | | | | |
| A2 | Permission-based nav | requester vs admin | signed in | Compare visible tiles/menu per role | Only permitted modules shown; admin sees all | | | | |
| A3 | Create request | requester | — | Create request w/ cost center, project/WBS, required date, priority, lines | Saved; all fields persisted | | | | |
| A4 | Requester details visible | erp/supervisor/picker | A3 submitted | Open request at ERP, allocation, picking, GI | Requester + dept/cost center/project/required date shown at every stage | | | | |
| A5 | Approval | manager | A3 submitted | Approve | Moves to ERP queue | | | | |
| A6 | Value approval matrix | manager/admin | high-value request | Manager approves high-value | Blocked (needs high-value perm); admin approves | | | | |
| A7 | Self-approval prevention | manager | manager is requester | Try to approve own | Blocked | | | | |
| A8 | ERP reservation | erp | approved | Enter reservation + movement type | Reserved; stock reserved figure updates | | | | |
| A9 | Allocation | supervisor | reserved | Allocate | FIFO/FEFO bin+batch assigned | | | | |
| A10 | Picker assignment | supervisor | allocated | Assign picker | Task created; picker notified | | | | |
| A11 | QR/bin scan | picker | assigned | Scan bin then batch QR; scan a wrong bin | Correct passes; wrong bin rejected (WRONG_BIN) | | | | |
| A12 | Manual scan fallback / admin override | picker/admin | assigned | Picker cannot skip; admin skips scan | Picker 403; admin skip recorded in audit | | | | |
| A13 | Picking + GI | picker/whoperator | scanned | Confirm picks → complete → post GI | Stock issued; status Pending ERP GI → GI posted | | | | |
| A14 | Partial completion | picker | short pick | Confirm less than reserved | Closed-with-shortage path correct | | | | |
| A15 | Reverse one step (each stage) | stage owner | request at each stage | Reverse from Approval, ERP, Allocation, Picker-assignment, Picking (no picks) | Returns to previous queue; reservation/allocation/task released; blocked once lines picked | | | | |
| A16 | GI reversal | whoperator | GI posted | Reverse GI | Stock returned; audit recorded | | | | |
| A17 | Reallocation | reallocation perm | batch in stock | Move part of a batch; try to move reserved | Split creates new QR; reserved cannot be moved | | | | |
| A18 | Goods receipt | goods_receipt | PO | Receive w/ bin; quality hold | Batch + QR generated; bin assigned; quality hold set | | | | |
| A19 | Quality inspection | quality | received on hold | Release/block/reject | State transitions correct | | | | |
| A20 | Cycle count | supervisor | batch | Count w/ variance; post | Batch adjusted; cannot post below reserved | | | | |
| A21 | Physical inventory | supervisor/admin | session | Blind count, recount, 4-eyes approve, freeze, post | System qty hidden from counter; own-variance approval blocked; warehouse frozen then posted | | | | |
| A22 | Shipping | shipping | GI-posted | Delivery order → pack → load → dispatch → deliver w/ POD | Each transition enforced; QR label; requester notified | | | | |
| A23 | Dashboard drill-through | any | data present | Tap KPI / top material / recent movement | Navigates to the relevant filtered screen | | | | |
| A24 | Cancellation | requester/admin | open request | Cancel | Reservations/allocations released | | | | |

## B. UX / localization / resilience

| # | Area | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|
| B1 | Arabic RTL | Settings → Arabic | UI flips to RTL, strings translated | | | | |
| B2 | Dark mode | Settings → Dark | Dark theme applied app-wide | | | | |
| B3 | Back button | On a deep screen press Back repeatedly | Pops screens; does not instantly kill app from Home (confirm-to-exit) | | | | |
| B4 | Offline / network loss | Enable airplane mode, use app | Graceful error, no crash; recovers when back online | | | | |
| B5 | Server URL | Fresh install | Defaults to https://wms.kynox.io | | | | |

## C. Push notifications (the PR #25 gate)

Trigger each with `POST /api/debug/push-test` (admin) → expect `success:true,
attemptedPush:true`.

| # | State | Steps | Expected | Actual | P/F | Evidence | Defect |
|---|---|---|---|---|---|---|---|
| C1 | Foreground | App open → fire | Tray notification appears once; `[push] foreground message received` + `notification displayed` | | | | |
| C2 | Background | Home (app backgrounded) → fire | Tray notification once; `[push] background message received` | | | | |
| C3 | Terminated | Swipe from recents → fire | Tray notification appears (may lag on battery-optimized OEMs) | | | | |
| C4 | Locked screen | Lock device → fire | Notification on lock screen | | | | |
| C5 | Tap routing | Tap a notification | App opens; if payload has route/requestId, request detail opens | | | | |
| C6 | Permission denied | Deny/revoke POST_NOTIFICATIONS → fire | No tray notification (expected); in-app inbox still updates | | | | |
| C7 | Permission later enabled | Re-grant in Settings → fire | Tray notification resumes | | | | |
| C8 | Token refresh | Reinstall / clear storage, sign in | `[push] token generated (len=…)`; re-registered; next push arrives | | | | |
| C9 | No duplicates | Repeat C1–C3 | Exactly one notification per message in every state | | | | |

## Sign-off
- Total: ___ pass / ___ fail. Blocking defects: ___
- UAT owner: ______  Signature/date: ______
- Decision: ☐ Push gate PASSED (PR #25 may merge) ☐ FAILED (defects: ______)
