import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';
import 'request_detail_screen.dart';

class RequestsScreen extends StatelessWidget {
  const RequestsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<List<Map<String, dynamic>>>(
      load: () async {
        final res = await session.api.get('/api/requests?limit=50');
        return List<Map<String, dynamic>>.from(
            (res['requests'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      },
      builder: (context, rows, refresh) {
        if (rows.isEmpty) {
          return ListView(children: const [
            SizedBox(height: 80),
            Center(child: Text('No material requests.', style: TextStyle(color: Colors.grey))),
          ]);
        }
        return ListView.separated(
          itemCount: rows.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final r = rows[i];
            return ListTile(
              title: Text('${r['request_number']}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${r['requester_name'] ?? ''} · ${r['department'] ?? '—'} · ${r['total_lines'] ?? 0} line(s)'),
                  Text(fmtDate(r['created_at']), style: const TextStyle(fontSize: 12, color: Colors.grey)),
                ],
              ),
              trailing: SizedBox(
                width: 130,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [StatusChip('${r['request_status']}')],
                ),
              ),
              isThreeLine: true,
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => RequestDetailScreen(requestId: r['id'] as int)));
                refresh();
              },
            );
          },
        );
      },
    );
  }
}
