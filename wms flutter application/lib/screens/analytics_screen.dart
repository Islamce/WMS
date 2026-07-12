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
                  classPill('Normal', s['normal_count'], const Color(0xFF2a78d6)),
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
                    final c = sev.contains('high') || sev.contains('crit')
                        ? const Color(0xFFe34948)
                        : sev.contains('warn') || sev.contains('med')
                            ? const Color(0xFFeda100)
                            : const Color(0xFF2a78d6);
                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.lightbulb_outline, color: c),
                      title: Text('${i['title'] ?? i['message'] ?? ''}'),
                      subtitle: (i['detail'] ?? i['message']) != null && i['title'] != null
                          ? Text('${i['detail'] ?? i['message']}')
                          : null,
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
