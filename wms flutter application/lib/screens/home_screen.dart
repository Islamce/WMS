import 'package:flutter/material.dart';

import '../core/session.dart';
import '../main.dart';
import 'dashboard_screen.dart';
import 'requests_screen.dart';
import 'create_request_screen.dart';
import 'approvals_screen.dart';
import 'erp_operator_screen.dart';
import 'warehouse_screen.dart';
import 'picking_screen.dart';
import 'gi_screen.dart';
import 'receiving_screen.dart';
import 'quality_screen.dart';
import 'batches_screen.dart';
import 'expiry_screen.dart';
import 'cycle_count_screen.dart';
import 'materials_screen.dart';
import 'users_screen.dart';
import 'audit_screen.dart';
import 'notifications_screen.dart';
import 'analytics_screen.dart';
import 'settings_screen.dart';

/// A navigable destination gated by a permission (string or list, any-of).
class NavDest {
  const NavDest(this.label, this.icon, this.permission, this.builder);
  final String label;
  final IconData icon;
  final dynamic permission;
  final Widget Function() builder;
}

/// The app menu — a mobile-focused subset of the web app's MENU, in the same
/// order and gated by the same permission keys.
const List<Object> _menu = [
  'General',
  NavDest('Dashboard', Icons.dashboard_outlined, 'dashboard', DashboardScreen.new),
  NavDest('AI Stock Analytics', Icons.insights_outlined, 'ai_analytics', AnalyticsScreen.new),
  NavDest('Notifications', Icons.notifications_outlined, 'notifications', NotificationsScreen.new),
  'Material Requests',
  NavDest('Create Request', Icons.note_add_outlined, 'create_request', CreateRequestScreen.new),
  NavDest('Requests', Icons.list_alt_outlined, 'material_requests', RequestsScreen.new),
  NavDest('Approvals', Icons.fact_check_outlined, 'approvals', ApprovalsScreen.new),
  NavDest('ERP Operator', Icons.hub_outlined, 'erp_operator', _erpOperator),
  'Warehouse Execution',
  NavDest('Bin & Batch Assign', Icons.auto_awesome_motion_outlined, 'bin_batch_assignment', _allocation),
  NavDest('Picker Assignment', Icons.person_add_alt_1_outlined, 'picker_assignment', _pickerAssign),
  NavDest('My Picking Tasks', Icons.qr_code_scanner, 'picking', PickingScreen.new),
  NavDest('Goods Issue Posting', Icons.local_shipping_outlined, 'gi_posting', GiScreen.new),
  'Receiving & Quality',
  NavDest('Goods Receipt', Icons.download_outlined, 'goods_receipt', ReceivingScreen.new),
  NavDest('Quality Inspection', Icons.science_outlined, 'quality', QualityScreen.new),
  NavDest('Batch Tracking', Icons.inventory_2_outlined, 'batch_tracking', BatchesScreen.new),
  NavDest('Expiry Alerts', Icons.schedule_outlined, 'expiry_alerts', ExpiryScreen.new),
  NavDest('Cycle Counting', Icons.checklist_outlined, 'cycle_count', CycleCountScreen.new),
  'Master Data & Admin',
  NavDest('Materials', Icons.category_outlined, 'materials', MaterialsScreen.new),
  NavDest('Users', Icons.group_outlined, 'users_management', UsersScreen.new),
  NavDest('Audit Trail', Icons.receipt_long_outlined, 'audit_trail', AuditScreen.new),
];

// Builders for screens that take a constructor argument (can't use `.new`).
Widget _erpOperator() => const ErpOperatorScreen();
Widget _allocation() => const WarehouseScreen(mode: WarehouseMode.allocate);
Widget _pickerAssign() => const WarehouseScreen(mode: WarehouseMode.assignPicker);

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  List<NavDest> _visible(Session s) {
    final out = <NavDest>[];
    for (final e in _menu) {
      if (e is NavDest && s.can(e.permission)) out.add(e);
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final dests = _visible(session);

    if (dests.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('WMS Mobile')),
        drawer: _buildDrawer(session, dests),
        body: const _NoAccess(),
      );
    }
    if (_index >= dests.length) _index = 0;
    final current = dests[_index];

    return Scaffold(
      appBar: AppBar(
        title: Text(current.label),
        actions: [
          IconButton(
            tooltip: 'Settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const SettingsScreen())),
          ),
        ],
      ),
      drawer: _buildDrawer(session, dests),
      body: current.builder(),
    );
  }

  Widget _buildDrawer(Session session, List<NavDest> dests) {
    // Rebuild the grouped list (with section headers) but only for visible items.
    final rows = <Widget>[];
    for (final e in _menu) {
      if (e is String) {
        final anyVisible = _menu
            .skipWhile((x) => x != e)
            .skip(1)
            .takeWhile((x) => x is NavDest)
            .whereType<NavDest>()
            .any((d) => session.can(d.permission));
        if (anyVisible) {
          rows.add(Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Text(e.toUpperCase(),
                style: const TextStyle(
                    fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey)),
          ));
        }
      } else if (e is NavDest && session.can(e.permission)) {
        final idx = dests.indexOf(e);
        rows.add(ListTile(
          leading: Icon(e.icon),
          title: Text(e.label),
          selected: idx == _index,
          onTap: () {
            setState(() => _index = idx);
            Navigator.pop(context);
          },
        ));
      }
    }
    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            DrawerHeader(
              margin: EdgeInsets.zero,
              decoration: const BoxDecoration(color: Color(0xFF2a78d6)),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.warehouse, color: Colors.white, size: 36),
                  const Spacer(),
                  Text(session.userName,
                      style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  Text(session.userRole,
                      style: const TextStyle(color: Colors.white70, fontSize: 13)),
                ],
              ),
            ),
            Expanded(child: ListView(padding: EdgeInsets.zero, children: rows)),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Sign out'),
              onTap: () => session.signOut(),
            ),
          ],
        ),
      ),
    );
  }
}

class _NoAccess extends StatelessWidget {
  const _NoAccess();
  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'Your account has no mobile screen permissions yet.\nAsk an administrator to grant access.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey),
        ),
      ),
    );
  }
}
