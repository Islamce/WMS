# WMS Workflow & Process Gap Analysis — Round 3

Date: 2026-07-16 · Scope: full process review (request → issue → outbound) across
web, mobile and backend, following the round-3 UAT feedback.

## 1. Process coverage map

| Process | Status | Where |
|---|---|---|
| Material Request | ✅ Complete | Create → submit → approval (incl. value thresholds / SoD) |
| Approval | ✅ Complete | Manager approvals + high-value matrix + self-approval block |
| Stock Verification | ✅ Complete | Live availability on request lines + material master |
| ERP Reservation | ✅ Complete | ERP operator queue (mandatory-field gate, non-stock guard) |
| Bin/Batch Allocation | ✅ Complete | FIFO/FEFO with reservation accounting + freeze check *(new)* |
| Picking | ✅ Complete | Assignment, acceptance SLA, QR/bin scan, shortage handling |
| Goods Issue | ✅ Complete | GI posting, ERP-error path, return-to-picker, reversal |
| Goods Receipt | ✅ Complete | PO-mandatory GR, auto batch + QR, quality hold, bin assignment, freeze check *(new)* |
| Quality | ✅ Complete | Release / block / reject after receiving |
| **Shipping / Outbound** | ✅ **Added this round** | Delivery orders → pack → load → dispatch → deliver (POD) with QR labels |
| Cycle Count | ✅ Complete | Batch-level counts with reserved-stock guard |
| **Annual / Periodic Inventory** | ✅ **Added this round** | Warehouse sessions: blind count, recount, 4-eyes variance approval, freeze, adjustment posting |
| **Reallocation / Transfer** | ✅ **Added this round** | Warehouse/bin/project moves, batch split with new QR, ledger + history |
| Material Adjustment | ✅ Complete | Via cycle count / inventory posting (audited, ledgered) |

## 2. Gaps found this round and their resolution

| # | Gap | Severity | Resolution |
|---|---|---|---|
| G-1 | Requester context (department, project, cost center, priority, required date) was dropped after approval — ERP operators, pickers and GI posters saw only the request number and name | High | All queue APIs now return the full requester block; web shows it as columns + a context card on every step; mobile shows a `RequestInfoCard` on ERP, picking, GI and warehouse screens |
| G-2 | Material master `total_stock` read the legacy `material_location_stock` table only, while GR/GI/counts move `batches` — stock looked frozen | High | Stock is now computed live from batches (+ legacy stock), with reserved and available figures; verified by regression test (GR immediately visible) |
| G-3 | No physical-inventory process beyond single-batch cycle counts; no freeze, so counts raced against movements | High | Inventory sessions (annual/periodic/ad-hoc) with a warehouse freeze that blocks receipts, allocations and reallocations until posted |
| G-4 | No outbound leg after GI — issued material left the system without delivery tracking or proof of delivery | High | Shipping module with status machine, requester notifications on dispatch/delivery, and scannable QR labels |
| G-5 | No controlled way to move stock between bins/warehouses/projects; ad-hoc bin PATCH had no history or quantity split | Medium | Reallocation module: movable-quantity guard (reserved never moves), partial split w/ new QR, cross-warehouse ledger entries, full history |
| G-6 | Inventory analysis lacked ABC/XYZ/FSN classification, EOQ and over/understock flags | Medium | Analytics engine extended; ABC-XYZ matrix + new insights on web AI page |
| G-7 | Variance approval had no segregation — the counter could approve their own variance | Medium | Four-eyes rule: a variance must be approved by someone other than its counter (admin exempt) |
| G-8 | Factory reset did not cover the new tables (would fail with FK errors) | Low | Reset order updated (shipments, reallocations, inventory sessions first) |

## 3. Mobile gaps resolved

| Issue | Root cause | Fix |
|---|---|---|
| App closes on Back | Single-route navigation: system back popped the only route | `PopScope`: back returns to the launchpad; double-press to exit |
| Request details missing in process screens | Screens showed request number only | Requester info card / detail rows on ERP, picking, GI, warehouse queues |
| Notifications "not working" | No badge/polling and (usually) the unreachable default server URL | Bell with unread badge polling every 60 s + notifications screen from any view |
| Manual server URL | Default was the Android-emulator loopback `10.0.2.2` | `https://wms.kynox.io` baked in (old installs migrated automatically); still editable in Settings |
| Scanning not working | No camera integration — manual text entry only | `mobile_scanner` camera screen (QR, Code128, EAN-13, DataMatrix/GS1) wired into picking; manual entry kept as fallback |
| Feature parity | Web-only modules | Mobile screens added for Reallocation, Physical Inventory and Shipping |

## 4. Remaining known gaps (accepted / future)

- **ERP connector is a stub** — reservations/GI documents are recorded locally;
  a real SAP/ERP integration replaces `server/services/erp.js`.
- **SQLite single-writer** — fine for one site / moderate load; the PostgreSQL
  migration plan (docs/POSTGRES-MIGRATION.md) covers multi-instance scale-out.
- **Push notifications** — mobile uses in-app polling; FCM push would need a
  Firebase project (deliberately not bundled).
- **Wave/route optimisation for picking and truck-load planning** — out of scope
  for the current phase; the shipping data model already carries vehicle/driver.
- **Offline mobile mode** — the app requires connectivity; an offline queue is a
  future enhancement.

## 5. Verification

- 282 end-to-end checks across 16 suites (`npm test`) — all passing.
- Playwright UI smoke + axe-core accessibility gate — passing.
- ESLint (incl. security plugin) — 0 errors.
- Flutter APK built by CI on every push; release published from `main`.
