import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Expiry Alerts — batches with stock approaching or past their expiry date,
/// grouped by severity. Read-only. Mirrors GET /api/master/expiry-alerts.
class ExpiryScreen extends StatelessWidget {
  const ExpiryScreen({super.key});

  Color _color(String? level) {
    switch (level) {
      case 'EXPIRED':
      case 'CRITICAL':
        return const Color(0xFFe34948);
      case 'NEAR_EXPIRY':
        return const Color(0xFFeda100);
      default:
        return const Color(0xFF2a78d6);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<Map<String, dynamic>>(
      load: () async => Map<String, dynamic>.from(await session.api.get('/api/master/expiry-alerts')),
      builder: (context, data, refresh) {
        final alerts = List<Map<String, dynamic>>.from(
            (data['alerts'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        final summary = Map<String, dynamic>.from(data['summary'] ?? {});
        if (alerts.isEmpty) {
          return ListView(children: const [
            SizedBox(height: 80),
            Center(child: Text('No expiry alerts. 🎉', style: TextStyle(color: Colors.grey))),
          ]);
        }
        return ListView(
          children: [
            Padding(
              padding: const EdgeInsets.all(10),
              child: Wrap(
                spacing: 8, runSpacing: 8,
                children: summary.entries.where((e) => (e.value ?? 0) as num > 0).map((e) {
                  return Chip(
                    label: Text('${e.key}: ${e.value}'),
                    backgroundColor: _color(e.key).withValues(alpha: 0.14),
                    side: BorderSide(color: _color(e.key).withValues(alpha: 0.4)),
                  );
                }).toList(),
              ),
            ),
            ...alerts.map((b) {
              final days = b['days_to_expiry'];
              return ListTile(
                leading: Icon(Icons.schedule, color: _color('${b['alert_level']}')),
                title: Text('${b['batch_number']} · ${b['material_code']}',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${b['material_description'] ?? ''}\n'
                    'WH ${b['warehouse_code'] ?? ''} · qty ${fmtQty(b['remaining_quantity'])} · exp ${b['expiry_date']}'),
                isThreeLine: true,
                trailing: Text(
                  days == null ? '' : (days is num && days < 0 ? 'expired' : '${days}d'),
                  style: TextStyle(color: _color('${b['alert_level']}'), fontWeight: FontWeight.bold),
                ),
              );
            }),
            const SizedBox(height: 20),
          ],
        );
      },
    );
  }
}
