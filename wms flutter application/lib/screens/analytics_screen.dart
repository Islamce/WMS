import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

class AnalyticsScreen extends StatelessWidget {
  const AnalyticsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<Map<String, dynamic>>(
      load: () async => Map<String, dynamic>.from(await session.api.get('/api/analytics')),
      builder: (context, data, refresh) {
        final s = Map<String, dynamic>.from(data['summary'] ?? {});
        final items = List<Map<String, dynamic>>.from(
            (data['items'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        final insights = List<Map<String, dynamic>>.from(
            (data['insights'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        final belowReorder = items.where((i) => i['below_reorder'] == true).toList();

        Widget classPill(String label, dynamic count, Color c) => Expanded(
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 3),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: c.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(children: [
                  Text(fmtQty(count),
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: c)),
                  Text(label, style: const TextStyle(fontSize: 11)),
                ]),
              ),
            );

        return ListView(
          children: [
            SectionCard(
              title: 'Movement classification',
              child: Column(children: [
                Row(children: [
                  classPill('Fast', s['fast_count'], const Color(0xFF1baf7a)),
                  classPill('Normal', s['normal_count'], const Color(0xFF31c3c9)),
                  classPill('Slow', s['slow_count'], const Color(0xFFeda100)),
                  classPill('Dead', s['dead_count'], const Color(0xFFe34948)),
                ]),
                const SizedBox(height: 12),
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  _stat('Analyzed', fmtQty(s['materials_analyzed'])),
                  _stat('Stock value', fmtQty(s['total_stock_value'])),
                  _stat('Below reorder', fmtQty(s['below_reorder_count'])),
                ]),
                const SizedBox(height: 8),
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  _stat('Dead value', fmtQty(s['dead_stock_value'])),
                ]),
              ]),
            ),
            if (insights.isNotEmpty)
              SectionCard(
                title: 'Insights',
                child: Column(
                  children: insights.map((i) {
                    final sev = '${i['severity'] ?? i['level'] ?? ''}'.toLowerCase();
                    final IconData icon;
                    final Color c;
                    if (sev.contains('high') || sev.contains('crit')) {
                      icon = Icons.error_outline;
                      c = const Color(0xFFe34948);
                    } else if (sev.contains('warn') || sev.contains('med')) {
                      icon = Icons.warning_amber_outlined;
                      c = const Color(0xFFeda100);
                    } else if (sev.contains('good')) {
                      icon = Icons.check_circle_outline;
                      c = const Color(0xFF1baf7a);
                    } else {
                      icon = Icons.info_outline;
                      c = const Color(0xFF31c3c9);
                    }
                    final title = '${i['title'] ?? i['message'] ?? ''}';
                    final detail = i['detail'] ?? (i['title'] != null ? i['message'] : null);
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: c.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(8),
                        border: Border(left: BorderSide(color: c, width: 3)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(icon, color: c, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                                if (detail != null) ...[
                                  const SizedBox(height: 3),
                                  Text('$detail', style: const TextStyle(fontSize: 12, color: Colors.black87)),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
            SectionCard(
              title: 'Below reorder point (${belowReorder.length})',
              child: belowReorder.isEmpty
                  ? const Text('All materials above their reorder point.',
                      style: TextStyle(color: Colors.grey))
                  : _ReorderTable(rows: belowReorder.take(30).toList()),
            ),
            const SizedBox(height: 20),
          ],
        );
      },
    );
  }

  Widget _stat(String label, String value) => Column(
        children: [
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
        ],
      );
}

/// Modern, scannable replacement for the old stacked-text rows: a real
/// column-aligned table (horizontally scrollable on narrow phones), with the
/// stock deficit and classification both shown as color-coded chips instead
/// of buried in a sentence.
class _ReorderTable extends StatelessWidget {
  const _ReorderTable({required this.rows});
  final List<Map<String, dynamic>> rows;

  Color _classColor(String cls) {
    switch (cls.toUpperCase()) {
      case 'FAST':
        return const Color(0xFF1baf7a);
      case 'SLOW':
        return const Color(0xFFeda100);
      case 'DEAD':
        return const Color(0xFFe34948);
      default:
        return const Color(0xFF31c3c9);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowHeight: 36,
        dataRowMinHeight: 44,
        dataRowMaxHeight: 56,
        columnSpacing: 20,
        headingTextStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey),
        dataTextStyle: const TextStyle(fontSize: 12.5),
        columns: const [
          DataColumn(label: Text('MATERIAL')),
          DataColumn(label: Text('ON HAND'), numeric: true),
          DataColumn(label: Text('REORDER'), numeric: true),
          DataColumn(label: Text('SAFETY'), numeric: true),
          DataColumn(label: Text('DEFICIT'), numeric: true),
          DataColumn(label: Text('CLASS')),
        ],
        rows: rows.map((m) {
          final onHand = (m['current_stock'] as num?)?.toDouble() ?? 0;
          final reorder = (m['reorder_point'] as num?)?.toDouble() ?? 0;
          final deficit = reorder - onHand;
          final cls = '${m['classification'] ?? ''}';
          final classColor = _classColor(cls);
          return DataRow(cells: [
            DataCell(SizedBox(
              width: 160,
              child: Text('${m['item_code']} · ${m['description'] ?? ''}',
                  maxLines: 1, overflow: TextOverflow.ellipsis),
            )),
            DataCell(Text(fmtQty(onHand),
                style: const TextStyle(color: Color(0xFFe34948), fontWeight: FontWeight.w600))),
            DataCell(Text(fmtQty(reorder))),
            DataCell(Text(fmtQty(m['safety_stock']))),
            DataCell(Text(deficit > 0 ? fmtQty(deficit) : '—',
                style: TextStyle(color: deficit > 0 ? const Color(0xFFe34948) : Colors.grey,
                    fontWeight: FontWeight.w600))),
            DataCell(Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: classColor.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(cls,
                  style: TextStyle(color: classColor, fontSize: 11, fontWeight: FontWeight.w600)),
            )),
          ]);
        }).toList(),
      ),
    );
  }
}
