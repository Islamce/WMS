import 'package:flutter/material.dart';

import '../main.dart';
import '../widgets/common.dart';
import 'picking_task_screen.dart';

class PickingScreen extends StatelessWidget {
  const PickingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<List<Map<String, dynamic>>>(
      load: () async {
        final res = await session.api.get('/api/picking/tasks');
        return List<Map<String, dynamic>>.from(
            (res['tasks'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      },
      builder: (context, tasks, refresh) {
        if (tasks.isEmpty) {
          return ListView(children: const [
            SizedBox(height: 80),
            Center(child: Text('No picking tasks assigned.', style: TextStyle(color: Colors.grey))),
          ]);
        }
        return ListView.separated(
          itemCount: tasks.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final t = tasks[i];
            return ListTile(
              leading: const CircleAvatar(child: Icon(Icons.qr_code_scanner)),
              title: Text('${t['request_number']}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text('ERP ${t['erp_reservation_number'] ?? t['erp_reference_number'] ?? '—'} · '
                  'MvT ${t['movement_type'] ?? '—'} · Plant ${t['plant'] ?? '—'}\n'
                  '${t['warehouse_code'] ?? ''} · SLoc ${t['storage_location'] ?? '—'} · '
                  '${t['total_lines'] ?? 0} line(s) · ${t['total_bin_locations'] ?? 0} bin(s)'),
              isThreeLine: true,
              trailing: SizedBox(
                width: 120,
                child: Align(alignment: Alignment.centerRight, child: StatusChip('${t['task_status']}')),
              ),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => PickingTaskScreen(taskId: t['id'] as int)));
                refresh();
              },
            );
          },
        );
      },
    );
  }
}
