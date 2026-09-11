import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/i18n.dart';
import '../core/session.dart';
import '../main.dart';
import '../widgets/common.dart';
import 'dashboard_screen.dart';
import 'requests_screen.dart';
import 'create_request_screen.dart';
import 'approvals_screen.dart';
import 'erp_operator_screen.dart';
import 'warehouse_screen.dart';
import 'bin_scan_screen.dart';
import 'picking_screen.dart';
import 'gi_screen.dart';
import 'receiving_screen.dart';
import 'quality_screen.dart';
import 'batches_screen.dart';
import 'expiry_screen.dart';
import 'cycle_count_screen.dart';
import 'inventory_screen.dart';
import 'reallocation_screen.dart';
import 'shipping_screen.dart';
import 'materials_screen.dart';
import 'users_screen.dart';
import 'audit_screen.dart';
import 'notifications_screen.dart';
import 'analytics_screen.dart';
import 'settings_screen.dart';
import 'subcontractor_screen.dart';
import 'warehouses_screen.dart';

/// A navigable destination gated by a permission (string or list, any-of).
class NavDest {
  const NavDest(this.label, this.icon, this.permission, this.builder);
  final String label;
  final IconData icon;
  final dynamic permission;
  final Widget Function() builder;
}

/// Section accent colours — same palette as the web launchpad, so the two
/// home pages read as one product.
const Map<String, Color> _sectionAccent = {
  'General': Color(0xFF31c3c9),
  'Material Requests': Color(0xFF7c3aed),
  'Warehouse Execution': Color(0xFF1baf7a),
  'Shipping & Outbound': Color(0xFFd6552a),
  'Receiving & Quality': Color(0xFFeda100),
  'Subcontractor Materials': Color(0xFF0f8a92),
  'Master Data & Admin': Color(0xFF5b6b86),
};

/// The app menu — a mobile-focused subset of the web app's MENU, in the same
/// order and gated by the same permission keys. The Home launchpad (null
/// permission = any signed-in user) is the landing view, like the web app.
const List<Object> _menu = [
  NavDest('Home', Icons.apps_outlined, null, _homePlaceholder),
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
  NavDest('Scan Bin', Icons.center_focus_strong_outlined, 'dashboard', BinScanScreen.new),
  NavDest('Bin & Batch Assign', Icons.auto_awesome_motion_outlined, 'bin_batch_assignment', _allocation),
  NavDest('Picker Assignment', Icons.person_add_alt_1_outlined, 'picker_assignment', _pickerAssign),
  NavDest('My Picking Tasks', Icons.qr_code_scanner, 'picking', PickingScreen.new),
  NavDest('Goods Issue Posting', Icons.local_shipping_outlined, 'gi_posting', GiScreen.new),
  NavDest('Stock Reallocation', Icons.swap_horiz_outlined, ['reallocation', 'bin_batch_assignment'], ReallocationScreen.new),
  'Shipping & Outbound',
  NavDest('Delivery & Dispatch', Icons.local_shipping, ['shipping', 'gi_posting'], ShippingScreen.new),
  'Receiving & Quality',
  NavDest('Goods Receipt', Icons.download_outlined, 'goods_receipt', ReceivingScreen.new),
  NavDest('Quality Inspection', Icons.science_outlined, 'quality', QualityScreen.new),
  NavDest('Batch Tracking', Icons.inventory_2_outlined, 'batch_tracking', BatchesScreen.new),
  NavDest('Expiry Alerts', Icons.schedule_outlined, 'expiry_alerts', ExpiryScreen.new),
  NavDest('Cycle Counting', Icons.checklist_outlined, 'cycle_count', CycleCountScreen.new),
  NavDest('Physical Inventory', Icons.inventory_outlined, ['inventory_count', 'cycle_count'], InventoryScreen.new),
  'Subcontractor Materials',
  NavDest('Deliveries & Stock', Icons.local_shipping_outlined,
      ['subcontractor_receiving', 'subcontractor_quality_inspection', 'subcontractor_admin'], SubcontractorScreen.new),
  'Master Data & Admin',
  NavDest('Warehouses / Site Stores', Icons.warehouse_outlined,
      ['warehouses_master', 'warehouse_dashboard'], WarehousesScreen.new),
  NavDest('Materials', Icons.category_outlined, 'materials', MaterialsScreen.new),
  NavDest('Users', Icons.group_outlined, 'users_management', UsersScreen.new),
  NavDest('Audit Trail', Icons.receipt_long_outlined, 'audit_trail', AuditScreen.new),
];

// Builders for screens that take a constructor argument (can't use `.new`).
Widget _homePlaceholder() => const SizedBox.shrink(); // Home is rendered by the state
Widget _erpOperator() => const ErpOperatorScreen();
Widget _allocation() => const WarehouseScreen(mode: WarehouseMode.allocate);
Widget _pickerAssign() => const WarehouseScreen(mode: WarehouseMode.assignPicker);

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  int _index = 0;
  int _unread = 0;
  Timer? _bellTimer;
  DateTime? _lastBackPress;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _refreshUnread();
      _bellTimer = Timer.periodic(const Duration(seconds: 60), (_) => _refreshUnread());
    });
  }

  @override
  void dispose() {
    _bellTimer?.cancel();
    super.dispose();
  }

  Future<void> _refreshUnread() async {
    if (!mounted) return;
    final session = SessionScope.of(context);
    if (!session.isAuthenticated || !session.can('notifications')) return;
    try {
      final res = await session.api.get('/api/notifications/unread-count');
      final n = (res['unread'] ?? 0) as num;
      if (mounted && n.toInt() != _unread) setState(() => _unread = n.toInt());
    } catch (_) {/* offline — keep the last badge */}
  }

  List<NavDest> _visible(Session s) {
    final out = <NavDest>[];
    for (final e in _menu) {
      if (e is NavDest && s.can(e.permission)) out.add(e);
    }
    return out;
  }

  /// System back: close the drawer, step back to the launchpad, and only exit
  /// the app on a double press from the launchpad itself.
  void _handleBack() {
    if (_scaffoldKey.currentState?.isDrawerOpen ?? false) {
      Navigator.of(context).pop(); // just closes the drawer
      return;
    }
    if (_index != 0) {
      setState(() => _index = 0);
      return;
    }
    final now = DateTime.now();
    if (_lastBackPress != null && now.difference(_lastBackPress!) < const Duration(seconds: 2)) {
      SystemNavigator.pop();
    } else {
      _lastBackPress = now;
      showSnack(context, t('Press back again to exit'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final dests = _visible(session);

    if (dests.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('KYNOX WMS')),
        drawer: _buildDrawer(session, dests),
        body: const _NoAccess(),
      );
    }
    if (_index >= dests.length) _index = 0;
    final current = dests[_index];

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _handleBack();
      },
      child: Scaffold(
        key: _scaffoldKey,
        appBar: AppBar(
          title: Text(t(current.label)),
          actions: [
            if (session.can('notifications'))
              IconButton(
                tooltip: t('Notifications'),
                icon: Badge(
                  isLabelVisible: _unread > 0,
                  label: Text(_unread > 99 ? '99+' : '$_unread'),
                  child: const Icon(Icons.notifications_outlined),
                ),
                onPressed: () async {
                  await Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => Scaffold(
                            appBar: AppBar(title: Text(t('Notifications'))),
                            body: const NotificationsScreen(),
                          )));
                  _refreshUnread();
                },
              ),
            IconButton(
              tooltip: 'Settings',
              icon: const Icon(Icons.settings_outlined),
              onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const SettingsScreen())),
            ),
          ],
        ),
        drawer: _buildDrawer(session, dests),
        body: Column(
          children: [
            const OfflineBanner(),
            Expanded(child: _index == 0 ? _buildLaunchpad(session, dests) : current.builder()),
          ],
        ),
      ),
    );
  }

  /// Launchpad landing page — the same method as the web home: colour-coded
  /// module tiles grouped by process, filtered by the user's permissions.
  Widget _buildLaunchpad(Session session, List<NavDest> dests) {
    final children = <Widget>[
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${_greeting()}, ${session.userName}',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(t('Pick a process to get started'),
                style: const TextStyle(color: Colors.grey, fontSize: 13)),
          ],
        ),
      ),
    ];
    String? section;
    var tiles = <Widget>[];
    void flush() {
      if (tiles.isEmpty) return;
      children.add(Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
        child: Text(t(section!).toUpperCase(),
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold,
                letterSpacing: 0.6, color: _sectionAccent[section] ?? Colors.grey)),
      ));
      children.add(Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Wrap(spacing: 8, runSpacing: 8, children: tiles),
      ));
      tiles = <Widget>[];
    }
    for (final e in _menu) {
      if (e is String) { flush(); section = e; }
      else if (e is NavDest && e.permission != null && session.can(e.permission)) {
        final accent = _sectionAccent[section] ?? const Color(0xFF31c3c9);
        final idx = dests.indexOf(e);
        tiles.add(_LaunchTile(
          label: t(e.label), icon: e.icon, accent: accent,
          onTap: () => setState(() => _index = idx),
        ));
      }
    }
    flush();
    children.add(const SizedBox(height: 24));
    return ListView(children: children);
  }

  String _greeting() {
    final h = DateTime.now().hour;
    if (h < 12) return t('Good morning');
    if (h < 18) return t('Good afternoon');
    return t('Good evening');
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
            child: Text(t(e).toUpperCase(),
                style: const TextStyle(
                    fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey)),
          ));
        }
      } else if (e is NavDest && session.can(e.permission)) {
        final idx = dests.indexOf(e);
        rows.add(ListTile(
          leading: Icon(e.icon),
          title: Text(t(e.label)),
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
              decoration: const BoxDecoration(color: Color(0xFF31c3c9)),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Image.asset('assets/brand/kynox_mark.png', width: 36, height: 36),
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
              title: Text(t('Sign out')),
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


/// A launchpad tile: accent-tinted icon badge + label, sized for two per row.
class _LaunchTile extends StatelessWidget {
  const _LaunchTile({required this.label, required this.icon, required this.accent, required this.onTap});
  final String label;
  final IconData icon;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final width = (MediaQuery.of(context).size.width - 32) / 2;
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: width,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: accent.withValues(alpha: 0.35)),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: accent, size: 22),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(label, maxLines: 2, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
