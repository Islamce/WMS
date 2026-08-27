import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';
import 'batches_screen.dart';
import 'bin_locations_screen.dart';
import 'materials_screen.dart';
import 'stock_movements_screen.dart';
import 'users_screen.dart';

void _drill(BuildContext context, String title, Widget screen) {
  Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: Text(title)), body: screen)));
}

// Fulfillment pipeline stages — mirrors the web dashboard's control-tower
// strip (public/js/pages/dashboard.js PIPELINE_STAGES), grouping the full
// workflow vocabulary into the lifecycle legs an operator scans for at a
// glance. Built entirely from execution.by_status — no fabricated data.
class _PipelineStage {
  const _PipelineStage(this.key, this.label, this.icon, this.statuses);
  final String key;
  final String label;
  final IconData icon;
  final List<String> statuses;
}

const List<_PipelineStage> _pipelineStages = [
  _PipelineStage('intake', 'Intake', Icons.inbox_outlined, ['Draft', 'Submitted']),
  _PipelineStage('approval', 'Approval', Icons.fact_check_outlined, [
    'Pending Manager Approval', 'Under Review', 'Returned to Requester', 'Approved',
    'Approved - Pending ERP Processing', 'Pending ERP Reservation', 'ERP Reservation Created',
    'Movement Type Assigned', 'Warehouse Assigned', 'Pending Warehouse Action',
    'Pending Bin Location Assignment', 'Location Assigned', 'Batch Assigned',
  ]),
  _PipelineStage('picking', 'Picking', Icons.qr_code_scanner, [
    'Pending Picker Assignment', 'Assigned to Picker', 'Pending Picker Acceptance',
    'Reminder Sent', 'Escalated to Supervisor', 'Accepted by Picker',
    'Picking in Progress', 'Picking Completed', 'Partially Picked',
  ]),
  _PipelineStage('gi', 'GI posting', Icons.local_shipping_outlined, ['Pending ERP GI', 'GI Posted']),
  _PipelineStage('completed', 'Completed', Icons.check_circle_outline,
      ['Completed', 'Partially Completed', 'Closed with Shortage']),
  _PipelineStage('attention', 'Attention', Icons.warning_amber_outlined,
      ['ERP Error', 'Rejected', 'Cancelled', 'On Hold', 'Reversed']),
];

Map<String, int> _pipelineCounts(List<Map<String, dynamic>> byStatus) {
  final counts = <String, int>{};
  for (final row in byStatus) {
    counts[row['status'] as String] = (row['count'] as num).toInt();
  }
  final out = <String, int>{};
  for (final stage in _pipelineStages) {
    out[stage.key] = stage.statuses.fold(0, (sum, s) => sum + (counts[s] ?? 0));
  }
  return out;
}

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final canKpi = session.can('kpi_dashboard');
    return AsyncView<Map<String, dynamic>>(
      load: () async {
        final dash = Map<String, dynamic>.from(await session.api.get('/api/dashboard'));
        Map<String, dynamic>? exec;
        if (canKpi) {
          try {
            exec = Map<String, dynamic>.from(await session.api.get('/api/kpi'));
          } catch (_) {
            exec = null; // KPI data unavailable — stock monitoring still works.
          }
        }
        return {'dashboard': dash, 'execution': exec};
      },
      builder: (context, bundle, refresh) {
        final data = Map<String, dynamic>.from(bundle['dashboard']);
        final execution = bundle['execution'] as Map<String, dynamic>?;
        final ek = execution == null ? null : Map<String, dynamic>.from(execution['kpis'] ?? {});
        final byStatus = execution == null
            ? <Map<String, dynamic>>[]
            : List<Map<String, dynamic>>.from((execution['by_status'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        final pipeline = _pipelineCounts(byStatus);

        final k = Map<String, dynamic>.from(data['kpis'] ?? {});
        final charts = Map<String, dynamic>.from(data['charts'] ?? {});
        final inOutSeries = List<Map<String, dynamic>>.from(
            (charts['in_out_over_time'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        final sparkIn = inOutSeries.map((d) => (d['in_qty'] as num?)?.toDouble() ?? 0).toList();
        final sparkOut = inOutSeries.map((d) => (d['out_qty'] as num?)?.toDouble() ?? 0).toList();

        void goMaterials() => _drill(context, 'Materials', const MaterialsScreen());
        void goBatches() => _drill(context, 'Batch Tracking', const BatchesScreen());
        void goUsers() => _drill(context, 'Users', const UsersScreen());
        void goBins(String status) => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => BinLocationsScreen(status: status)));
        void goMovements({String? type, bool today = false}) => _drill(
            context,
            type == 'IN' ? 'Stock In (today)' : type == 'OUT' ? 'Stock Out (today)' : 'Recent movements',
            StockMovementsScreen(type: type, today: today));

        final canOpenBins = session.can('dashboard');
        // Matches the actual permission gate on GET /api/stock/transactions.
        final canSeeMovements = session.can(['stock_in', 'stock_out', 'dashboard']);
        final tiles = <_Kpi>[
          _Kpi('Materials', k['total_materials'], Icons.inventory_2_outlined, const Color(0xFF31c3c9),
              session.can('materials') ? goMaterials : null, null),
          _Kpi('Total Stock', k['total_stock'], Icons.warehouse_outlined, const Color(0xFF1baf7a),
              session.can('batch_tracking') ? goBatches : null, null),
          _Kpi('Bin Locations', k['total_locations'], Icons.grid_view_outlined, const Color(0xFF31c3c9),
              canOpenBins ? () => goBins('all') : null, null),
          _Kpi('Occupied Bins', k['occupied_locations'], Icons.inventory_outlined, const Color(0xFF1baf7a),
              canOpenBins ? () => goBins('occupied') : null, null),
          _Kpi('Empty Bins', k['empty_locations'], Icons.crop_free, const Color(0xFFeda100),
              canOpenBins ? () => goBins('empty') : null, null),
          _Kpi('Stock In (today)', k['stock_in_today'], Icons.south_west, const Color(0xFF1baf7a),
              canSeeMovements ? () => goMovements(type: 'IN', today: true) : null, sparkIn),
          _Kpi('Stock Out (today)', k['stock_out_today'], Icons.north_east, const Color(0xFFe34948),
              canSeeMovements ? () => goMovements(type: 'OUT', today: true) : null, sparkOut),
          _Kpi('Pending Users', k['pending_users'], Icons.how_to_reg_outlined, const Color(0xFFeda100),
              session.can('users_management') ? goUsers : null, null),
        ];
        final recent = List<Map<String, dynamic>>.from(
            (data['recent_transactions'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        final topMaterials = List<Map<String, dynamic>>.from(
            (data['top_materials'] ?? []).map((e) => Map<String, dynamic>.from(e)));

        final exceptions = ek == null ? <_Exception>[] : <_Exception>[
          _Exception((ek['erp_error'] as num?)?.toInt() ?? 0, 'ERP posting errors', 'critical'),
          _Exception((ek['shortage_lines'] as num?)?.toInt() ?? 0, 'Shortage lines', 'warning'),
          _Exception((ek['expired_batches'] as num?)?.toInt() ?? 0, 'Expired batches', 'critical'),
          _Exception((ek['qr_scan_failure'] as num?)?.toInt() ?? 0, 'Failed QR scans', 'warning'),
          _Exception((ek['open'] as num?)?.toInt() ?? 0, 'Open requests', 'info'),
          _Exception((ek['partially_completed'] as num?)?.toInt() ?? 0, 'Partially completed', 'warning'),
        ];

        return ListView(
          children: [
            if (execution != null) ...[
              const Padding(
                padding: EdgeInsets.fromLTRB(14, 14, 14, 6),
                child: Text('Fulfillment pipeline', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              ),
              SizedBox(
                height: 92,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  children: _pipelineStages.map((s) => _PipelineTile(stage: s, count: pipeline[s.key] ?? 0)).toList(),
                ),
              ),
              if (exceptions.any((e) => e.value > 0)) ...[
                const Padding(
                  padding: EdgeInsets.fromLTRB(14, 14, 14, 6),
                  child: Text('Action required', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: exceptions.where((e) => e.value > 0).map((e) => _ExceptionChip(e)).toList(),
                  ),
                ),
              ],
            ] else
              const Padding(
                padding: EdgeInsets.fromLTRB(14, 14, 14, 0),
                child: Text('Execution KPI data is unavailable or not permitted. Stock monitoring remains active.',
                    style: TextStyle(color: Colors.grey, fontSize: 12)),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: 1.6,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                children: tiles.map((t) => _KpiCard(t)).toList(),
              ),
            ),
            if (topMaterials.isNotEmpty)
              SectionCard(
                title: 'Top materials by stock',
                child: Column(
                  children: topMaterials.take(8).map((m) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text('${m['item_code']} · ${m['description'] ?? ''}',
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    trailing: Text('${fmtQty(m['quantity'])} ${m['unit'] ?? ''}',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    onTap: session.can('materials') ? goMaterials : null,
                  )).toList(),
                ),
              ),
            SectionCard(
              title: 'Recent movements',
              trailing: canSeeMovements
                  ? TextButton(onPressed: () => goMovements(), child: const Text('View all'))
                  : null,
              child: recent.isEmpty
                  ? const Text('No transactions yet.', style: TextStyle(color: Colors.grey))
                  : Column(
                      children: recent.map((tx) {
                        final isIn = (tx['transaction_type'] ?? '') == 'IN';
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(isIn ? Icons.south_west : Icons.north_east,
                              color: isIn ? const Color(0xFF1baf7a) : const Color(0xFFe34948)),
                          title: Text('${tx['item_code'] ?? ''} · ${tx['material_description'] ?? ''}',
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Text('${tx['location_code'] ?? ''} · ${fmtDate(tx['transaction_date'])}'),
                          trailing: Text('${isIn ? '+' : '-'}${fmtQty(tx['quantity'])}',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: isIn ? const Color(0xFF1baf7a) : const Color(0xFFe34948))),
                          onTap: canSeeMovements ? () => goMovements() : null,
                        );
                      }).toList(),
                    ),
            ),
            const SizedBox(height: 20),
          ],
        );
      },
    );
  }
}

class _Exception {
  const _Exception(this.value, this.label, this.level);
  final int value;
  final String label;
  final String level; // critical | warning | info
}

class _ExceptionChip extends StatelessWidget {
  const _ExceptionChip(this.e);
  final _Exception e;
  @override
  Widget build(BuildContext context) {
    final color = switch (e.level) {
      'critical' => const Color(0xFFe34948),
      'warning' => const Color(0xFFeda100),
      _ => const Color(0xFF31c3c9),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Text('${e.value}', style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 15)),
        const SizedBox(width: 6),
        Text(e.label, style: TextStyle(color: color, fontSize: 12)),
      ]),
    );
  }
}

class _PipelineTile extends StatelessWidget {
  const _PipelineTile({required this.stage, required this.count});
  final _PipelineStage stage;
  final int count;
  @override
  Widget build(BuildContext context) {
    final active = stage.key == 'picking' && count > 0;
    final attention = stage.key == 'attention' && count > 0;
    final color = attention
        ? const Color(0xFFe34948)
        : active
            ? const Color(0xFF31c3c9)
            : Colors.grey.shade600;
    return Container(
      width: 78,
      margin: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(children: [
        Container(
          width: 40, height: 40,
          decoration: BoxDecoration(
            color: (active || attention) ? color.withValues(alpha: 0.14) : Colors.grey.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(stage.icon, size: 18, color: color),
        ),
        const SizedBox(height: 6),
        Text('$count', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: color)),
        Text(stage.label, textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 10, color: Colors.grey)),
      ]),
    );
  }
}

class _Kpi {
  const _Kpi(this.label, this.value, this.icon, this.color, this.onTap, this.sparkline);
  final String label;
  final dynamic value;
  final IconData icon;
  final Color color;
  final VoidCallback? onTap;
  final List<double>? sparkline;
}

class _KpiCard extends StatelessWidget {
  const _KpiCard(this.kpi);
  final _Kpi kpi;
  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: kpi.onTap,
        child: Stack(children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Row(children: [
                  Icon(kpi.icon, color: kpi.color, size: 20),
                  const Spacer(),
                  Flexible(
                    child: Text(fmtQty(kpi.value),
                        style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: kpi.color)),
                  ),
                  if (kpi.onTap != null) ...[
                    const SizedBox(width: 4),
                    Icon(Icons.chevron_right, size: 16, color: kpi.color.withValues(alpha: 0.6)),
                  ],
                ]),
                const SizedBox(height: 6),
                Text(kpi.label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ],
            ),
          ),
          if (kpi.sparkline != null && kpi.sparkline!.length > 1)
            Positioned(
              right: 10, bottom: 8,
              child: SizedBox(width: 56, height: 20, child: CustomPaint(painter: _SparklinePainter(kpi.sparkline!, kpi.color))),
            ),
        ]),
      ),
    );
  }
}

/// A minimal trend sparkline — mirrors the inline-SVG sparklines on the web
/// KPI tiles, drawn from the same 30-day movement series.
class _SparklinePainter extends CustomPainter {
  _SparklinePainter(this.values, this.color);
  final List<double> values;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final maxV = values.reduce(math.max);
    final minV = values.reduce(math.min);
    final range = (maxV - minV) == 0 ? 1 : (maxV - minV);
    final step = size.width / (values.length - 1);
    final path = Path();
    for (var i = 0; i < values.length; i++) {
      final x = i * step;
      final y = size.height - ((values[i] - minV) / range) * size.height;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    canvas.drawPath(path, Paint()
      ..color = color.withValues(alpha: 0.85)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6);
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter oldDelegate) =>
      oldDelegate.values != values || oldDelegate.color != color;
}
