import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../main.dart';
import '../widgets/common.dart';

class GiScreen extends StatefulWidget {
  const GiScreen({super.key});
  @override
  State<GiScreen> createState() => _GiScreenState();
}

class _GiScreenState extends State<GiScreen> {
  int _key = 0;
  bool _busy = false;

  Future<void> _post(int id) async {
    final ctrl = TextEditingController(
        text: '49${DateTime.now().millisecondsSinceEpoch.toString().substring(5)}');
    final doc = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Post Goods Issue'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'GI document number', border: OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (ctrl.text.trim().isEmpty) return;
              Navigator.pop(context, ctrl.text.trim());
            },
            child: const Text('Post'),
          ),
        ],
      ),
    );
    if (doc == null) return;
    setState(() => _busy = true);
    try {
      final res = await SessionScope.of(context).api
          .post('/api/gi/$id/post', {'gi_document_number': doc});
      if (mounted) {
        showSnack(context, 'GI posted. ${res['status'] ?? ''}');
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _returnToPicker(int id) async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Return to picker'),
        content: TextField(
          controller: ctrl, autofocus: true, maxLines: 2,
          decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Back')),
          FilledButton(
            onPressed: () {
              if (ctrl.text.trim().isEmpty) return;
              Navigator.pop(context, ctrl.text.trim());
            },
            child: const Text('Return'),
          ),
        ],
      ),
    );
    if (reason == null) return;
    setState(() => _busy = true);
    try {
      await SessionScope.of(context).api.post('/api/gi/$id/return-to-picker', {'reason': reason});
      if (mounted) {
        showSnack(context, 'Returned to picker.');
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Stack(children: [
      AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_key),
        load: () async {
          final res = await session.api.get('/api/gi');
          return List<Map<String, dynamic>>.from(
              (res['requests'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, rows, refresh) {
          if (rows.isEmpty) {
            return ListView(children: const [
              SizedBox(height: 80),
              Center(child: Text('No requests awaiting Goods Issue.', style: TextStyle(color: Colors.grey))),
            ]);
          }
          return ListView(
            children: rows.map((r) {
              final id = r['id'] as int;
              return Card(
                margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Expanded(child: Text('${r['request_number']}',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
                        StatusChip('${r['request_status']}'),
                      ]),
                      const SizedBox(height: 4),
                      Text('${r['requester_name'] ?? ''}'
                          '${(r['department'] ?? '').toString().isNotEmpty ? ' · ${r['department']}' : ''}'
                          '${(r['project'] ?? '').toString().isNotEmpty ? ' · ${r['project']}' : ''}'
                          '${(r['cost_center'] ?? '').toString().isNotEmpty ? ' · ${r['cost_center']}' : ''}',
                          style: const TextStyle(fontSize: 13)),
                      Text('WH ${r['issue_warehouse_code'] ?? ''} · MvT ${r['movement_type'] ?? ''} · '
                          '${r['total_lines'] ?? 0} line(s)'),
                      if ((r['erp_reservation_number'] ?? '').toString().isNotEmpty)
                        Text('Reservation ${r['erp_reservation_number']}',
                            style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      if ((r['erp_error_message'] ?? '').toString().isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text('${r['erp_error_message']}',
                              style: const TextStyle(fontSize: 12, color: Color(0xFFe34948))),
                        ),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(
                          child: FilledButton.icon(
                            icon: const Icon(Icons.local_shipping, size: 18),
                            label: const Text('Post GI'),
                            onPressed: _busy ? null : () => _post(id),
                          ),
                        ),
                        const SizedBox(width: 8),
                        OutlinedButton.icon(
                          icon: const Icon(Icons.undo, size: 18),
                          label: const Text('Return'),
                          onPressed: _busy ? null : () => _returnToPicker(id),
                        ),
                      ]),
                    ],
                  ),
                ),
              );
            }).toList(),
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
