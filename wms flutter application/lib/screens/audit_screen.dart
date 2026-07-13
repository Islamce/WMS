import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Audit Trail — the append-only change log (most recent first). Read-only.
/// Mirrors GET /api/master/audit.
class AuditScreen extends StatelessWidget {
  const AuditScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<List<Map<String, dynamic>>>(
      load: () async {
        final res = await session.api.get('/api/master/audit?limit=50');
        return List<Map<String, dynamic>>.from(
            (res['audit'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      },
      builder: (context, rows, refresh) {
        if (rows.isEmpty) {
          return ListView(children: const [
            SizedBox(height: 80),
            Center(child: Text('No audit records.', style: TextStyle(color: Colors.grey))),
          ]);
        }
        return ListView.separated(
          itemCount: rows.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final a = rows[i];
            final subtitleParts = <String>[
              if ((a['entity_type'] ?? '').toString().isNotEmpty) '${a['entity_type']}',
              if ((a['request_number'] ?? '').toString().isNotEmpty) '${a['request_number']}',
              if ((a['changed_by_name'] ?? '').toString().isNotEmpty) 'by ${a['changed_by_name']}',
            ];
            final oldV = (a['old_value'] ?? '').toString();
            final newV = (a['new_value'] ?? '').toString();
            return ListTile(
              dense: true,
              leading: const Icon(Icons.history, size: 20),
              title: Text('${a['action'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(subtitleParts.join(' · ')),
                  if (oldV.isNotEmpty || newV.isNotEmpty)
                    Text(
                      [if (oldV.isNotEmpty) 'from $oldV', if (newV.isNotEmpty) 'to $newV'].join(' '),
                      maxLines: 2, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11, color: Colors.grey),
                    ),
                  Text(fmtDate(a['changed_at']), style: const TextStyle(fontSize: 11, color: Colors.grey)),
                ],
              ),
              isThreeLine: true,
            );
          },
        );
      },
    );
  }
}
