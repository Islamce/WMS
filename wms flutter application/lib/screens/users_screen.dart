import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Users Management — approve / reject pending signups and enable / disable
/// accounts. Mirrors PATCH /api/users/:id/status.
class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});
  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  int _key = 0;
  bool _busy = false;

  Future<void> _setStatus(int id, String status) async {
    setState(() => _busy = true);
    try {
      await SessionScope.of(context).api.patch('/api/users/$id/status', {'status': status});
      if (mounted) {
        showSnack(context, 'User $status.');
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'active': return const Color(0xFF1baf7a);
      case 'pending': return const Color(0xFFeda100);
      case 'rejected':
      case 'disabled': return const Color(0xFFe34948);
      default: return const Color(0xFF31c3c9);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Stack(children: [
      AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_key),
        load: () async {
          final res = await session.api.get('/api/users');
          return List<Map<String, dynamic>>.from(
              (res['users'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, rows, refresh) {
          // Pending first, then the rest.
          rows.sort((a, b) {
            int rank(String s) => s == 'pending' ? 0 : 1;
            return rank('${a['status']}').compareTo(rank('${b['status']}'));
          });
          if (rows.isEmpty) {
            return ListView(children: const [
              SizedBox(height: 80),
              Center(child: Text('No users.', style: TextStyle(color: Colors.grey))),
            ]);
          }
          return ListView.separated(
            itemCount: rows.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final u = rows[i];
              final id = u['id'] as int;
              final status = '${u['status']}';
              return ListTile(
                title: Text('${u['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${u['email']} · ${u['role'] ?? ''}'),
                trailing: Wrap(
                  spacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: _statusColor(status).withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(status, style: TextStyle(color: _statusColor(status), fontSize: 12)),
                    ),
                    if (status == 'pending') ...[
                      IconButton(
                        tooltip: 'Approve',
                        icon: const Icon(Icons.check_circle, color: Color(0xFF1baf7a)),
                        onPressed: _busy ? null : () => _setStatus(id, 'active'),
                      ),
                      IconButton(
                        tooltip: 'Reject',
                        icon: const Icon(Icons.cancel, color: Color(0xFFe34948)),
                        onPressed: _busy ? null : () => _setStatus(id, 'rejected'),
                      ),
                    ] else if (status == 'active')
                      IconButton(
                        tooltip: 'Disable',
                        icon: const Icon(Icons.block, color: Color(0xFFe34948)),
                        onPressed: _busy ? null : () => _setStatus(id, 'disabled'),
                      )
                    else
                      IconButton(
                        tooltip: 'Activate',
                        icon: const Icon(Icons.restart_alt, color: Color(0xFF1baf7a)),
                        onPressed: _busy ? null : () => _setStatus(id, 'active'),
                      ),
                  ],
                ),
              );
            },
          );
        },
      ),
      if (_busy)
        const Positioned.fill(
          child: ColoredBox(color: Color(0x33000000), child: Center(child: CircularProgressIndicator())),
        ),
    ]);
  }
}
