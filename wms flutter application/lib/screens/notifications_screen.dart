import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  int _key = 0;

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<Map<String, dynamic>>(
      key: ValueKey(_key),
      load: () async => Map<String, dynamic>.from(await session.api.get('/api/notifications')),
      builder: (context, data, refresh) {
        final rows = List<Map<String, dynamic>>.from(
            (data['notifications'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        final unread = data['unread'] ?? 0;
        return Column(
          children: [
            if (rows.isNotEmpty)
              Padding(
                padding: const EdgeInsets.all(8),
                child: Row(
                  children: [
                    Text('$unread unread', style: const TextStyle(color: Colors.grey)),
                    const Spacer(),
                    TextButton.icon(
                      icon: const Icon(Icons.done_all, size: 18),
                      label: const Text('Mark all read'),
                      onPressed: () async {
                        await session.api.post('/api/notifications/read-all');
                        setState(() => _key++);
                      },
                    ),
                  ],
                ),
              ),
            Expanded(
              child: rows.isEmpty
                  ? ListView(children: const [
                      SizedBox(height: 80),
                      Center(child: Text('No notifications.', style: TextStyle(color: Colors.grey))),
                    ])
                  : ListView.separated(
                      itemCount: rows.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        final n = rows[i];
                        final isRead = (n['is_read'] ?? 0) == 1 || n['read_at'] != null;
                        return ListTile(
                          leading: Icon(
                            isRead ? Icons.notifications_none : Icons.notifications_active,
                            color: isRead ? Colors.grey : const Color(0xFF2a78d6),
                          ),
                          title: Text('${n['title'] ?? n['notification_type'] ?? ''}',
                              style: TextStyle(fontWeight: isRead ? FontWeight.normal : FontWeight.w600)),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if ((n['message'] ?? '').toString().isNotEmpty) Text('${n['message']}'),
                              Text(fmtDate(n['created_at']),
                                  style: const TextStyle(fontSize: 11, color: Colors.grey)),
                            ],
                          ),
                          isThreeLine: (n['message'] ?? '').toString().isNotEmpty,
                          onTap: isRead
                              ? null
                              : () async {
                                  await session.api.post('/api/notifications/${n['id']}/read');
                                  setState(() => _key++);
                                },
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }
}
