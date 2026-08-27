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
                  : Column(
                      children: belowReorder.take(20).map((m) => ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text('${m['item_code']} · ${m['description'] ?? ''}',
                                maxLines: 1, overflow: TextOverflow.ellipsis),
                            subtitle: Text('On hand ${fmtQty(m['current_stock'])} · '
                                'reorder ${fmtQty(m['reorder_point'])} · '
                                'safety ${fmtQty(m['safety_stock'])}'),
                            trailing: Text('${m['classification'] ?? ''}',
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                          )).toList(),
                    ),
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
