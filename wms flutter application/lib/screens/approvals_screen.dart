import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../main.dart';
import '../widgets/common.dart';

class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  int _key = 0;
  bool _busy = false;

  Future<void> _decide(int id, String decision, {String? reason}) async {
    final session = SessionScope.of(context);
    setState(() => _busy = true);
    try {
      await session.api.post('/api/approvals/$id/decision', {
        'decision': decision,
        if (reason != null) 'reason': reason,
      });
      if (mounted) {
        showSnack(context, decision == 'approve' ? 'Request approved.' : 'Request $decision.');
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject(int id, String kind) async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(kind == 'reject' ? 'Reject request' : 'Return to requester'),
        content: TextField(
          controller: ctrl, autofocus: true, maxLines: 3,
          decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Back')),
          FilledButton(
            onPressed: () {
              if (ctrl.text.trim().isEmpty) return;
              Navigator.pop(context, ctrl.text.trim());
            },
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (reason == null) return;
    await _decide(id, kind, reason: reason);
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Stack(children: [
      AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_key),
        load: () async {
          final res = await session.api.get('/api/approvals');
          return List<Map<String, dynamic>>.from(
              (res['requests'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, rows, refresh) {
          return ListView(
            children: [
              _MatrixBanner(session: session),
              if (rows.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 60),
                  child: Center(
                      child: Text('No requests awaiting approval.',
                          style: TextStyle(color: Colors.grey))),
                ),
              ...rows.map((r) {
              final id = r['id'] as int;
              return Card(
                margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Expanded(
                          child: Text('${r['request_number']}',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        ),
                        StatusChip('${r['request_status']}'),
                      ]),
                      const SizedBox(height: 4),
                      Text('${r['requester_name'] ?? ''} · ${r['department'] ?? '—'} · '
                          '${r['priority'] ?? ''} · ${r['total_lines'] ?? 0} line(s)'),
                      Text('Submitted ${fmtDate(r['submitted_at'])}',
                          style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(
                          child: FilledButton.icon(
                            icon: const Icon(Icons.check, size: 18),
                            label: const Text('Approve'),
                            onPressed: _busy ? null : () => _decide(id, 'approve'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            icon: const Icon(Icons.close, size: 18),
                            label: const Text('Reject'),
                            onPressed: _busy ? null : () => _reject(id, 'reject'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton(
                          tooltip: 'Return to requester',
                          icon: const Icon(Icons.undo),
                          onPressed: _busy ? null : () => _reject(id, 'return'),
                        ),
                      ]),
                    ],
                  ),
                ),
              );
            }),
          ],
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

/// Read-only banner showing the value-based approval authority matrix, so an
/// approver knows up front which requests need a higher authority. Mirrors
/// GET /api/approvals/matrix. Renders nothing if there are no thresholds.
class _MatrixBanner extends StatelessWidget {
  const _MatrixBanner({required this.session});
  final Session session;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: () async {
        try {
          final res = await session.api.get('/api/approvals/matrix');
          return List<Map<String, dynamic>>.from(
              (res['thresholds'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        } catch (_) {
          return <Map<String, dynamic>>[];
        }
      }(),
      builder: (context, snap) {
        final rows = snap.data ?? [];
        if (rows.isEmpty) return const SizedBox.shrink();
        return Card(
          margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          color: const Color(0xFFFFF7E6),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(children: [
                  Icon(Icons.gavel_outlined, size: 18, color: Color(0xFF9a6a00)),
                  SizedBox(width: 6),
                  Text('Approval authority',
                      style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF9a6a00))),
                ]),
                const SizedBox(height: 6),
                ...rows.map((t) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Text(
                        '≥ ${t['min_amount']} ${t['currency'] ?? ''} → needs "${t['required_permission']}"',
                        style: const TextStyle(fontSize: 13, color: Color(0xFF6b5200)),
                      ),
                    )),
              ],
            ),
          ),
        );
      },
    );
  }
}
