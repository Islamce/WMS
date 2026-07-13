import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Quality inspection queue — batches on QUALITY_HOLD after receiving. The
/// inspector releases them or blocks/rejects (reason required). Mirrors
/// POST /api/master/batches/:id/quality.
class QualityScreen extends StatefulWidget {
  const QualityScreen({super.key});
  @override
  State<QualityScreen> createState() => _QualityScreenState();
}

class _QualityScreenState extends State<QualityScreen> {
  int _key = 0;
  bool _busy = false;

  Future<void> _setStatus(int id, String status) async {
    String? reason;
    if (status != 'RELEASED') {
      final ctrl = TextEditingController();
      reason = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(status == 'BLOCKED' ? 'Block batch' : 'Reject batch'),
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
              child: const Text('Confirm'),
            ),
          ],
        ),
      );
      if (reason == null) return;
    }
    setState(() => _busy = true);
    try {
      await SessionScope.of(context).api.post('/api/master/batches/$id/quality', {
        'quality_status': status,
        if (reason != null) 'reason': reason,
      });
      if (mounted) {
        showSnack(context, 'Batch $status.');
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
          final res = await session.api.get('/api/master/batches?quality=QUALITY_HOLD');
          return List<Map<String, dynamic>>.from(
              (res['batches'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, rows, refresh) {
          if (rows.isEmpty) {
            return ListView(children: const [
              SizedBox(height: 80),
              Center(child: Text('No batches pending inspection.', style: TextStyle(color: Colors.grey))),
            ]);
          }
          return ListView(
            children: rows.map((b) {
              final id = b['id'] as int;
              return Card(
                margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${b['batch_number']}',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                      Text('${b['material_code']} · ${b['material_description'] ?? ''}',
                          maxLines: 2, overflow: TextOverflow.ellipsis),
                      Text('WH ${b['warehouse_code'] ?? ''} · Qty ${fmtQty(b['remaining_quantity'])} · '
                          'PO ${b['po_number'] ?? '—'}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      if ((b['expiry_date'] ?? '').toString().isNotEmpty)
                        Text('Expiry ${b['expiry_date']}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(
                          child: FilledButton.icon(
                            icon: const Icon(Icons.check_circle_outline, size: 18),
                            label: const Text('Release'),
                            onPressed: _busy ? null : () => _setStatus(id, 'RELEASED'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        OutlinedButton(
                          onPressed: _busy ? null : () => _setStatus(id, 'BLOCKED'),
                          child: const Text('Block'),
                        ),
                        const SizedBox(width: 8),
                        OutlinedButton(
                          onPressed: _busy ? null : () => _setStatus(id, 'REJECTED'),
                          child: const Text('Reject'),
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
