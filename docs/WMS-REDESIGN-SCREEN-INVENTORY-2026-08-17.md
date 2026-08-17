# KYNOX WMS Forensic Inventory

Generated: 2026-08-17

## Web page modules
adminViews.js
ai.js
alllocations.js
allocation.js
approvals.js
auth.js
createRequest.js
cycleCount.js
dashboard.js
emptylocations.js
erpOperator.js
giPosting.js
home.js
importCenter.js
inventory.js
locations.js
materials.js
movementHistory.js
permissions.js
pickerAssign.js
picking.js
reallocation.js
receiving.js
requestDetail.js
requests.js
shipping.js
stockin.js
stockout.js
users.js
warehouseData.js

## Server route modules
admin.js
analytics.js
approvals.js
attachments.js
auth.js
cycleCount.js
dashboard.js
erpOperator.js
export.js
gi.js
import.js
inventory.js
kpi.js
locations.js
masterdata.js
materials.js
meta.js
notifications.js
openingStockReconcile.js
permissions.js
picking.js
reallocation.js
receiving.js
requests.js
shipping.js
stock.js
users.js
warehouse.js

## Flutter screens
analytics_screen.dart
approvals_screen.dart
audit_screen.dart
batch_detail_screen.dart
batches_screen.dart
bin_locations_screen.dart
create_request_screen.dart
cycle_count_screen.dart
dashboard_screen.dart
erp_operator_screen.dart
expiry_screen.dart
gi_screen.dart
home_screen.dart
inventory_screen.dart
login_screen.dart
materials_screen.dart
notifications_screen.dart
picking_screen.dart
picking_task_screen.dart
quality_screen.dart
reallocation_screen.dart
receiving_screen.dart
request_detail_screen.dart
requests_screen.dart
scan_screen.dart
settings_screen.dart
shipping_screen.dart
users_screen.dart
warehouse_screen.dart

## Web route declarations
62:    { route: 'dashboard', label: 'Dashboard', icon: 'grid', permission: 'dashboard' },
63:    { route: 'kpi', label: 'KPI Dashboard', icon: 'bar-chart', permission: 'kpi_dashboard' },
64:    { route: 'ai', label: 'AI Stock Analytics', icon: 'cpu', permission: 'ai_analytics' },
65:    { route: 'notifications', label: 'Notifications', icon: 'bell', permission: 'notifications' },
68:    { route: 'create-request', label: 'Create Request', icon: 'file-plus', permission: 'create_request' },
69:    { route: 'requests', label: 'Requests', icon: 'list', permission: 'material_requests' },
70:    { route: 'approvals', label: 'Approvals', icon: 'check-circle', permission: 'approvals' },
71:    { route: 'erp-operator', label: 'ERP Operator', icon: 'link', permission: 'erp_operator' },
74:    { route: 'warehouse', label: 'Warehouse Dashboard', icon: 'home', permission: 'warehouse_dashboard' },
75:    { route: 'allocation', label: 'Bin & Batch Assign', icon: 'compass', permission: 'bin_batch_assignment' },
76:    { route: 'picker-assign', label: 'Picker Assignment', icon: 'user-plus', permission: 'picker_assignment' },
77:    { route: 'picking', label: 'My Picking Tasks', icon: 'smartphone', permission: 'picking' },
78:    { route: 'gi-posting', label: 'Goods Issue Posting', icon: 'send', permission: 'gi_posting' },
79:    { route: 'reallocation', label: 'Stock Reallocation', icon: 'shuffle', permission: ['reallocation', 'bin_batch_assignment'] },
82:    { route: 'shipping', label: 'Delivery & Dispatch', icon: 'truck', permission: ['shipping', 'gi_posting'] },
85:    { route: 'receiving', label: 'Goods Receipt & QR', icon: 'download', permission: ['goods_receipt', 'erp_operator', 'picking'] },
86:    { route: 'qr-printing', label: 'QR Label Printing', icon: 'printer', permission: ['qr_printing', 'goods_receipt'] },
87:    { route: 'batches', label: 'Batch Tracking', icon: 'layers', permission: 'batch_tracking' },
88:    { route: 'expiry', label: 'Expiry Alerts', icon: 'clock', permission: 'expiry_alerts' },
89:    { route: 'cycle-count', label: 'Cycle Counting', icon: 'clipboard', permission: 'cycle_count' },
90:    { route: 'quality', label: 'Quality', icon: 'shield', permission: 'quality' },
93:    { route: 'physical-inventory', label: 'Physical Inventory', icon: 'clipboard', permission: ['inventory_count', 'cycle_count'] },
94:    { route: 'all-locations', label: 'All Locations', icon: 'map', permission: 'all_locations' },
95:    { route: 'empty-locations', label: 'Empty Locations', icon: 'square', permission: 'empty_locations' },
98:    { route: 'materials', label: 'Materials', icon: 'box', permission: 'materials' },
99:    { route: 'locations', label: 'Locations', icon: 'pin', permission: 'locations' },
100:    { route: 'warehouses-master', label: 'Warehouses', icon: 'home', permission: 'warehouses_master' },
101:    { route: 'bins-master', label: 'Bin Locations', icon: 'archive', permission: 'bins_master' },
102:    { route: 'movement-types', label: 'Movement Types', icon: 'shuffle', permission: 'movement_types_master' },
103:    { route: 'import', label: 'Import Data', icon: 'download', permission: ['materials', 'locations', 'warehouses_master', 'bins_master', 'movement_types_master', 'goods_receipt'] },
106:    { route: 'audit', label: 'Audit Trail', icon: 'file-text', permission: 'audit_trail' },
107:    { route: 'users', label: 'Users', icon: 'users', permission: 'users_management' },
108:    { route: 'permissions', label: 'Permissions', icon: 'lock', permission: 'permissions_management' },
119:  'home': { title: 'Home', page: 'home', permission: null }, // launchpad — any signed-in user
120:  'dashboard': { title: 'Dashboard', page: 'dashboard', permission: 'dashboard' },
121:  'kpi': { title: 'KPI Dashboard', page: 'kpi', permission: 'kpi_dashboard' },
122:  'ai': { title: 'AI Stock Analytics', page: 'ai', permission: 'ai_analytics' },
123:  'notifications': { title: 'Notifications', page: 'notifications', permission: 'notifications' },
124:  'create-request': { title: 'Create Material Request', page: 'createRequest', permission: 'create_request' },
125:  'requests': { title: 'Material Requests', page: 'requests', permission: 'material_requests' },
126:  'request-detail': { title: 'Request Detail', page: 'requestDetail', permission: 'material_requests' },
127:  'approvals': { title: 'Manager Approvals', page: 'approvals', permission: 'approvals' },
128:  'erp-operator': { title: 'ERP Operator Queue', page: 'erpOperator', permission: 'erp_operator' },
129:  'warehouse': { title: 'Warehouse Dashboard', page: 'warehouse', permission: 'warehouse_dashboard' },
130:  'allocation': { title: 'Bin & Batch Assignment', page: 'allocation', permission: 'bin_batch_assignment' },
131:  'picker-assign': { title: 'Picker Assignment', page: 'pickerAssign', permission: 'picker_assignment' },
132:  'picking': { title: 'My Picking Tasks', page: 'picking', permission: 'picking' },
133:  'gi-posting': { title: 'Goods Issue Posting', page: 'giPosting', permission: 'gi_posting' },
134:  'reallocation': { title: 'Stock Reallocation', page: 'reallocation', permission: ['reallocation', 'bin_batch_assignment'] },
135:  'shipping': { title: 'Shipping & Outbound', page: 'shipping', permission: ['shipping', 'gi_posting'] },
136:  'physical-inventory': { title: 'Physical Inventory', page: 'inventory', permission: ['inventory_count', 'cycle_count'] },
137:  'receiving': { title: 'Goods Receipt & QR', page: 'receiving', permission: ['goods_receipt', 'erp_operator', 'picking'] },
138:  'qr-printing': { title: 'QR Label Printing', page: 'qrPrinting', permission: ['qr_printing', 'goods_receipt'] },
139:  'batches': { title: 'Batch Tracking', page: 'batches', permission: 'batch_tracking' },
140:  'expiry': { title: 'Expiry Alerts', page: 'expiry', permission: 'expiry_alerts' },
141:  'cycle-count': { title: 'Cycle Counting', page: 'cycleCount', permission: 'cycle_count' },
142:  'quality': { title: 'Quality Management', page: 'quality', permission: 'quality' },
143:  'stock-in': { title: 'Stock In', page: 'stockin', permission: 'stock_in' },
144:  'stock-out': { title: 'Stock Out', page: 'stockout', permission: 'stock_out' },
145:  'all-locations': { title: 'All Locations', page: 'alllocations', permission: 'all_locations' },
146:  'empty-locations': { title: 'Empty Locations', page: 'emptylocations', permission: 'empty_locations' },
147:  'materials': { title: 'Materials', page: 'materials', permission: 'materials' },
148:  'locations': { title: 'Locations', page: 'locations', permission: 'locations' },
149:  'warehouses-master': { title: 'Warehouse Master', page: 'warehousesMaster', permission: 'warehouses_master' },
150:  'bins-master': { title: 'Bin Location Master', page: 'binsMaster', permission: 'bins_master' },
151:  'movement-types': { title: 'Movement Type Config', page: 'movementTypes', permission: 'movement_types_master' },
152:  'import': { title: 'Import Center', page: 'importCenter', permission: ['materials', 'locations', 'warehouses_master', 'bins_master', 'movement_types_master', 'goods_receipt'] },
153:  'audit': { title: 'Audit Trail', page: 'audit', permission: 'audit_trail' },
154:  'users': { title: 'Users Management', page: 'users', permission: 'users_management' },
155:  'permissions': { title: 'Permissions Management', page: 'permissions', permission: 'permissions_management' },

## Canonical workflow status references
10:  DRAFT: 'Draft',
11:  SUBMITTED: 'Submitted',
12:  PENDING_MANAGER_APPROVAL: 'Pending Manager Approval',
16:  APPROVED: 'Approved',
17:  APPROVED_PENDING_ERP: 'Approved - Pending ERP Processing',
19:  ERP_RESERVATION_CREATED: 'ERP Reservation Created',
23:  PENDING_BIN_ASSIGNMENT: 'Pending Bin Location Assignment',
26:  PENDING_PICKER_ASSIGNMENT: 'Pending Picker Assignment',
29:  REMINDER_SENT: 'Reminder Sent',
30:  ESCALATED_TO_SUPERVISOR: 'Escalated to Supervisor',
32:  PICKING_IN_PROGRESS: 'Picking in Progress',
33:  PICKING_COMPLETED: 'Picking Completed',
35:  PENDING_ERP_GI: 'Pending ERP GI',
36:  GI_POSTED: 'GI Posted',
37:  COMPLETED: 'Completed',
38:  PARTIALLY_COMPLETED: 'Partially Completed',
39:  CLOSED_WITH_SHORTAGE: 'Closed with Shortage',
42:  ERP_ERROR: 'ERP Error',
43:  REVERSED: 'Reversed',
48:  DRAFT: 'Draft',
50:  APPROVED: 'Approved',
60:  PICKING_IN_PROGRESS: 'Picking in Progress',
70:  GI_POSTED: 'GI Posted',
71:  REVERSED: 'Reversed',
80:  REMINDER_SENT: 'Reminder Sent',
85:  COMPLETED: 'Picking Completed',
86:  PARTIALLY_COMPLETED: 'Partially Completed',
94:  [HEADER_STATUS.DRAFT]: [HEADER_STATUS.SUBMITTED, HEADER_STATUS.CANCELLED],
95:  [HEADER_STATUS.SUBMITTED]: [HEADER_STATUS.PENDING_MANAGER_APPROVAL, HEADER_STATUS.CANCELLED],
96:  [HEADER_STATUS.PENDING_MANAGER_APPROVAL]: [
97:    HEADER_STATUS.UNDER_REVIEW, HEADER_STATUS.APPROVED, HEADER_STATUS.REJECTED,
101:    HEADER_STATUS.APPROVED, HEADER_STATUS.REJECTED, HEADER_STATUS.RETURNED_TO_REQUESTER,
103:  [HEADER_STATUS.RETURNED_TO_REQUESTER]: [HEADER_STATUS.SUBMITTED, HEADER_STATUS.CANCELLED],
104:  [HEADER_STATUS.APPROVED]: [HEADER_STATUS.APPROVED_PENDING_ERP],
105:  [HEADER_STATUS.APPROVED_PENDING_ERP]: [HEADER_STATUS.PENDING_ERP_RESERVATION, HEADER_STATUS.ERP_RESERVATION_CREATED],
106:  [HEADER_STATUS.PENDING_ERP_RESERVATION]: [HEADER_STATUS.ERP_RESERVATION_CREATED, HEADER_STATUS.ON_HOLD],
107:  [HEADER_STATUS.ERP_RESERVATION_CREATED]: [HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED],
109:  [HEADER_STATUS.WAREHOUSE_ASSIGNED]: [HEADER_STATUS.PENDING_WAREHOUSE_ACTION, HEADER_STATUS.PENDING_BIN_ASSIGNMENT],
110:  [HEADER_STATUS.PENDING_WAREHOUSE_ACTION]: [HEADER_STATUS.PENDING_BIN_ASSIGNMENT],
111:  [HEADER_STATUS.PENDING_BIN_ASSIGNMENT]: [HEADER_STATUS.LOCATION_ASSIGNED],
112:  [HEADER_STATUS.LOCATION_ASSIGNED]: [HEADER_STATUS.BATCH_ASSIGNED, HEADER_STATUS.PENDING_PICKER_ASSIGNMENT],
113:  [HEADER_STATUS.BATCH_ASSIGNED]: [HEADER_STATUS.PENDING_PICKER_ASSIGNMENT],
116:  [HEADER_STATUS.PENDING_PICKER_ASSIGNMENT]: [HEADER_STATUS.ASSIGNED_TO_PICKER, HEADER_STATUS.LOCATION_ASSIGNED],
119:    HEADER_STATUS.REMINDER_SENT, HEADER_STATUS.ESCALATED_TO_SUPERVISOR, HEADER_STATUS.ACCEPTED_BY_PICKER,
121:  [HEADER_STATUS.REMINDER_SENT]: [
122:    HEADER_STATUS.ESCALATED_TO_SUPERVISOR, HEADER_STATUS.ACCEPTED_BY_PICKER, HEADER_STATUS.REMINDER_SENT,
124:  [HEADER_STATUS.ESCALATED_TO_SUPERVISOR]: [HEADER_STATUS.ASSIGNED_TO_PICKER, HEADER_STATUS.ACCEPTED_BY_PICKER],
125:  [HEADER_STATUS.ACCEPTED_BY_PICKER]: [HEADER_STATUS.PICKING_IN_PROGRESS],
126:  [HEADER_STATUS.PICKING_IN_PROGRESS]: [HEADER_STATUS.PICKING_COMPLETED, HEADER_STATUS.PARTIALLY_PICKED],
127:  [HEADER_STATUS.PICKING_COMPLETED]: [HEADER_STATUS.PENDING_ERP_GI],
128:  [HEADER_STATUS.PARTIALLY_PICKED]: [HEADER_STATUS.PENDING_ERP_GI],
129:  // PICKING_IN_PROGRESS is allowed backwards from the GI stage so the GI
131:  [HEADER_STATUS.PENDING_ERP_GI]: [
132:    HEADER_STATUS.GI_POSTED, HEADER_STATUS.ERP_ERROR, HEADER_STATUS.PICKING_IN_PROGRESS,
134:  [HEADER_STATUS.GI_POSTED]: [
135:    HEADER_STATUS.COMPLETED, HEADER_STATUS.PARTIALLY_COMPLETED, HEADER_STATUS.CLOSED_WITH_SHORTAGE,
139:  [HEADER_STATUS.COMPLETED]: [HEADER_STATUS.REVERSED],
140:  [HEADER_STATUS.PARTIALLY_COMPLETED]: [HEADER_STATUS.REVERSED],
141:  [HEADER_STATUS.CLOSED_WITH_SHORTAGE]: [HEADER_STATUS.REVERSED],
142:  [HEADER_STATUS.ERP_ERROR]: [
143:    HEADER_STATUS.PENDING_ERP_GI, HEADER_STATUS.ON_HOLD, HEADER_STATUS.PICKING_IN_PROGRESS,
160:  [HEADER_STATUS.PENDING_MANAGER_APPROVAL]: HEADER_STATUS.DRAFT,
161:  [HEADER_STATUS.UNDER_REVIEW]: HEADER_STATUS.DRAFT,
163:  [HEADER_STATUS.APPROVED_PENDING_ERP]: HEADER_STATUS.PENDING_MANAGER_APPROVAL,
164:  [HEADER_STATUS.PENDING_ERP_RESERVATION]: HEADER_STATUS.PENDING_MANAGER_APPROVAL,
165:  [HEADER_STATUS.ERP_RESERVATION_CREATED]: HEADER_STATUS.PENDING_MANAGER_APPROVAL,
166:  [HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED]: HEADER_STATUS.PENDING_MANAGER_APPROVAL,
170:  [HEADER_STATUS.PENDING_BIN_ASSIGNMENT]: HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED,
174:  [HEADER_STATUS.PENDING_PICKER_ASSIGNMENT]: HEADER_STATUS.PENDING_BIN_ASSIGNMENT,
176:  [HEADER_STATUS.ASSIGNED_TO_PICKER]: HEADER_STATUS.PENDING_PICKER_ASSIGNMENT,
177:  [HEADER_STATUS.PENDING_PICKER_ACCEPTANCE]: HEADER_STATUS.PENDING_PICKER_ASSIGNMENT,
178:  [HEADER_STATUS.REMINDER_SENT]: HEADER_STATUS.PENDING_PICKER_ASSIGNMENT,
179:  [HEADER_STATUS.ESCALATED_TO_SUPERVISOR]: HEADER_STATUS.PENDING_PICKER_ASSIGNMENT,
180:  [HEADER_STATUS.ACCEPTED_BY_PICKER]: HEADER_STATUS.PENDING_PICKER_ASSIGNMENT,
181:  [HEADER_STATUS.PICKING_IN_PROGRESS]: HEADER_STATUS.PENDING_PICKER_ASSIGNMENT,
183:  [HEADER_STATUS.PENDING_ERP_GI]: HEADER_STATUS.PICKING_IN_PROGRESS,
184:  [HEADER_STATUS.ERP_ERROR]: HEADER_STATUS.PICKING_IN_PROGRESS,

## Relevant browser/e2e tests
tests/e2e/autoseed_guard_test.py
tests/e2e/backup_retention_test.py
tests/e2e/backup_test.py
tests/e2e/corrective_integrity_test.py
tests/e2e/features_test.py
tests/e2e/idempotency_test.py
tests/e2e/import_test.py
tests/e2e/movement_history_import_test.py
tests/e2e/operational_semantics_migration_test.js
tests/e2e/p0_hardening_test.py
tests/e2e/p0_regression_test.py
tests/e2e/p1_hardening_test.py
tests/e2e/p1_regression_test.py
tests/e2e/p2_test.py
tests/e2e/p3_test.py
tests/e2e/password_test.py
tests/e2e/quickwins_test.py
tests/e2e/r3_test.py
tests/e2e/refinements_test.py
tests/e2e/reports_test.py
tests/e2e/request_line_visibility_test.py
tests/e2e/reverse_workflow_test.py
tests/e2e/uat2_test.py
tests/e2e/uat_test.py
tests/e2e/workflow_test.py
tests/load/smoke-load.js
tests/navigation-v2-observer.test.js
tests/smoke/design_foundation_browser.js
tests/smoke/playwright_smoke.js
tests/smoke/request_line_visibility_browser.js
