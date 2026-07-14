import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Cycle Counting — open a count against a batch, enter the physical count, and
/// post the variance (which adjusts batch stock + the ledger). Mirrors
/// /api/cycle-count. Gated by the `cycle_count` permission.
class CycleCountScreen extends StatefulWidget {
  const CycleCountScreen({super.key});
  @override
  State<CycleCountScreen> createState() => _CycleCountScreenState();
}

class _CycleCountScreenState extends State<CycleCountScreen> {
  int _key = 0;
  bool _busy = false;

  Color _statusColor(String s) {
    switch (s) {
      case 'POSTED':
        return const Color(0xFF1baf7a);
      case 'COUNTED':
        return const Color(0xFF2a78d6);
      case 'CANCELLED':
        return const Color(0xFFe34948);
      default:
        return const Color(0xFFeda100);
    }
  }

  Future<void> _run(Future<void> Function(dynamic api) body, String ok) async {
    final session = SessionScope.of(context);
    setState(() => _busy = true);
    try {
      await body(session.api);
      if (mounted) { showSnack(context, ok); setState(() => _key++); }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _newCount() async {
    final batch = await _pickBatch();
    if (batch == null) return;
    await _run((api) => api.post('/api/cycle-count', {'batch_id': batch['id']}),
        'Cycle count opened.');
  }

  Future<void> _enter(int id) async {
    final ctrl = TextEditingController();
    final reasonCtrl = TextEditingController();
    final qty = await showDialog<double>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Enter count'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: ctrl, autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                  labelText: 'Counted quantity', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: reasonCtrl,
              decoration: const InputDecoration(
                  labelText: 'Reason (optional)', border: OutlineInputBorder()),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Back')),
          FilledButton(
            onPressed: () {
              final v = double.tryParse(ctrl.text.trim());
              if (v == null || v < 0) return;
              Navigator.pop(context, v);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (qty == null) return;
    await _run(
        (api) => api.post('/api/cycle-count/$id/count',
            {'counted_quantity': qty, 'reason': reasonCtrl.text.trim()}),
        'Count recorded.');
  }

  Future<void> _post(int id) =>
      _run((api) => api.post('/api/cycle-count/$id/post'), 'Cycle count posted.');

  /// Batch picker dialog: search + tap to select. Returns the batch map.
  Future<Map<String, dynamic>?> _pickBatch() {
    final session = SessionScope.of(context);
    return showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) {
        final ctrl = TextEditingController();
        return StatefulBuilder(builder: (context, setLocal) {
          String q = ctrl.text.trim();
          return AlertDialog(
            title: const Text('Select a batch'),
            content: SizedBox(
              width: double.maxFinite,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: ctrl,
                    decoration: const InputDecoration(
                        hintText: 'Search material / batch',
                        prefixIcon: Icon(Icons.search),
                        border: OutlineInputBorder(), isDense: true),
                    onSubmitted: (_) => setLocal(() {}),
                    onChanged: (_) => setLocal(() {}),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    height: 260,
                    child: FutureBuilder<List<Map<String, dynamic>>>(
                      key: ValueKey(q),
                      future: () async {
                        if (q.isEmpty) return <Map<String, dynamic>>[];
                        final res = await session.api.get(
                            '/api/master/batches?search=${Uri.encodeQueryComponent(q)}');
                        return List<Map<String, dynamic>>.from(
                            (res['batches'] ?? []).map((e) => Map<String, dynamic>.from(e)));
                      }(),
                      builder: (context, snap) {
                        if (q.isEmpty) {
                          return const Center(
                              child: Text('Type to search batches',
                                  style: TextStyle(color: Colors.grey)));
                        }
                        if (snap.connectionState == ConnectionState.waiting) {
                          return const Center(child: CircularProgressIndicator());
                        }
                        final rows = snap.data ?? [];
                        if (rows.isEmpty) {
                          return const Center(
                              child: Text('No matches', style: TextStyle(color: Colors.grey)));
                        }
                        return ListView(
                          children: rows.take(20).map((b) => ListTile(
                                dense: true,
                                title: Text('${b['batch_number']} · ${b['material_code']}'),
                                subtitle: Text(
                                    'On hand ${b['remaining_quantity']} · ${b['warehouse_code'] ?? ''} ${b['bin_location'] ?? ''}'),
                                onTap: () => Navigator.pop(context, b),
                              )).toList(),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('Back')),
            ],
          );
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Stack(children: [
      Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(10),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                icon: const Icon(Icons.add),
                label: const Text('New count'),
                onPressed: _busy ? null : _newCount,
              ),
            ),
          ),
          Expanded(
            child: AsyncView<List<Map<String, dynamic>>>(
              key: ValueKey(_key),
              load: () async {
                final res = await session.api.get('/api/cycle-count');
                return List<Map<String, dynamic>>.from(
                    (res['counts'] ?? []).map((e) => Map<String, dynamic>.from(e)));
              },
              builder: (context, rows, refresh) {
                if (rows.isEmpty) {
                  return ListView(children: const [
                    SizedBox(height: 60),
                    Center(child: Text('No cycle counts yet.',
                        style: TextStyle(color: Colors.grey))),
                  ]);
                }
                return ListView(
                  children: rows.map((c) {
                    final status = '${c['status']}';
                    final variance = c['variance'];
                    final id = c['id'] as int;
                    return Card(
                      margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [
                              Expanded(
                                child: Text('${c['count_number']} · ${c['material_code'] ?? ''}',
                                    style: const TextStyle(fontWeight: FontWeight.bold)),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: _statusColor(status).withValues(alpha: 0.14),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(status,
                                    style: TextStyle(
                                        color: _statusColor(status),
                                        fontSize: 12, fontWeight: FontWeight.w600)),
                              ),
                            ]),
                            const SizedBox(height: 4),
                            Text(
                              'System ${c['system_quantity']}'
                              '${c['counted_quantity'] != null ? ' · Counted ${c['counted_quantity']}' : ''}'
                              '${variance != null ? ' · Var ${variance > 0 ? '+' : ''}$variance' : ''}',
                              style: const TextStyle(fontSize: 13, color: Colors.grey),
                            ),
                            if (status == 'OPEN' || status == 'COUNTED') ...[
                              const SizedBox(height: 8),
                              Row(children: [
                                if (status == 'OPEN')
                                  FilledButton.tonalIcon(
                                    icon: const Icon(Icons.edit, size: 16),
                                    label: const Text('Enter count'),
                                    onPressed: _busy ? null : () => _enter(id),
                                  ),
                                if (status == 'COUNTED')
                                  FilledButton.icon(
                                    icon: const Icon(Icons.check, size: 16),
                                    label: const Text('Post'),
                                    onPressed: _busy ? null : () => _post(id),
                                  ),
                              ]),
                            ],
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                );
              },
            ),
          ),
        ],
      ),
      if (_busy)
        const Positioned.fill(
          child: ColoredBox(
              color: Color(0x33000000), child: Center(child: CircularProgressIndicator())),
        ),
    ]);
  }
}
