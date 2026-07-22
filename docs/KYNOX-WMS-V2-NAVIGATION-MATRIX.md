# KYNOX WMS V2 — Navigation Matrix

| Target group | New screen label | Existing route | Existing permission |
|---|---|---|---|
| Command Center | Operations Overview | `dashboard` | `dashboard` |
| Command Center | KPI Cockpit | `kpi` | `kpi_dashboard` |
| Command Center | Alerts & Notifications | `notifications` | `notifications` |
| Demand & Requests | Create Material Request | `create-request` | `create_request` |
| Demand & Requests | Request Workspace | `requests` | `material_requests` |
| Demand & Requests | Approval Workbench | `approvals` | `approvals` |
| Demand & Requests | ERP Processing Queue | `erp-operator` | `erp_operator` |
| Inbound Operations | Goods Receipt | `receiving` | `goods_receipt`, `erp_operator`, or `picking` |
| Inbound Operations | QR & Label Printing | `qr-printing` | `qr_printing` or `goods_receipt` |
| Inbound Operations | Quality Inspection | `quality` | `quality` |
| Inbound Operations | Batch Control | `batches` | `batch_tracking` |
| Inbound Operations | Expiry Control | `expiry` | `expiry_alerts` |
| Warehouse Execution | Execution Dashboard | `warehouse` | `warehouse_dashboard` |
| Warehouse Execution | Allocation & Reservation | `allocation` | `bin_batch_assignment` |
| Warehouse Execution | Picker Assignment | `picker-assign` | `picker_assignment` |
| Warehouse Execution | My Warehouse Tasks | `picking` | `picking` |
| Warehouse Execution | Internal Transfer & Reallocation | `reallocation` | `reallocation` or `bin_batch_assignment` |
| Outbound Operations | Goods Issue | `gi-posting` | `gi_posting` |
| Outbound Operations | Delivery & Dispatch | `shipping` | `shipping` or `gi_posting` |
| Inventory Control | Physical Inventory | `physical-inventory` | `inventory_count` or `cycle_count` |
| Inventory Control | Cycle Counting | `cycle-count` | `cycle_count` |
| Inventory Control | Location Stock Overview | `all-locations` | `all_locations` |
| Inventory Control | Empty Location Capacity | `empty-locations` | `empty_locations` |
| Intelligence & Analytics | AI Operations Center | `ai` | `ai_analytics` |
| Master Data & Integration | Materials | `materials` | `materials` |
| Master Data & Integration | Storage Locations | `locations` | `locations` |
| Master Data & Integration | Warehouses | `warehouses-master` | `warehouses_master` |
| Master Data & Integration | Bin Locations | `bins-master` | `bins_master` |
| Master Data & Integration | Movement Types | `movement-types` | `movement_types_master` |
| Master Data & Integration | Import Center | `import` | applicable master-data or receipt permission |
| Governance & Administration | Audit Trail | `audit` | `audit_trail` |
| Governance & Administration | Users & Roles | `users` | `users_management` |
| Governance & Administration | Permissions | `permissions` | `permissions_management` |

## Implementation rule

Phase 1 changes labels, grouping, ordering, styling, and usability only. Route names and permission keys remain unchanged to protect API, test, mobile, and bookmark compatibility.