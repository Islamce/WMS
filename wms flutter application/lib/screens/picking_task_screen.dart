import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Picker task detail: accept → start → scan QR per allocation → confirm each
/// line (shortage reason mandatory on partial) → complete. Mirrors the web
/// picking flow; QR values are entered manually (or via a scanner app that
/// pastes into the field).
class PickingTaskScreen extends StatefulWidget {
  const PickingTaskScreen({super.key, required this.taskId});
  final int taskId;
  @override
  State<PickingTaskScreen> createState() => _PickingTaskScreenState();
}

class _PickingTaskScreenState extends State<PickingTaskScreen> {
  int _key = 0;
  bool _busy = false;

  Future<Map<String, dynamic>> _load() async =>
      Map<String, dynamic>.from(await SessionScope.of(context).api.get('/api/picking/tasks/${widget.taskId}'));

  Future<void> _run(Future<void> Function() action, {String? ok}) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted && ok != null) showSnack(context, ok);
      if (mounted) setState(() => _key++);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = SessionScope.of(context).api;
    return Scaffold(
      appBar: AppBar(title: const Text('Picking Task')),
      body: Stack(children: [
        AsyncView<Map<String, dynamic>>(
          key: ValueKey(_key),
          load: _load,
          builder: (context, data, refresh) {
            final task = Map<String, dynamic>.from(data['task'] ?? {});
            final lines = List<Map<String, dynamic>>.from(
                (data['lines'] ?? []).map((e) => Map<String, dynamic>.from(e)));
            final allocations = List<Map<String, dynamic>>.from(
                (data['allocations'] ?? []).map((e) => Map<String, dynamic>.from(e)));
            final status = '${task['task_status']}';

            return ListView(
              children: [
                SectionCard(
                  title: '${task['request_number']}',
                  trailing: StatusChip(status),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Warehouse: ${task['warehouse_code'] ?? ''}'),
                      Text('Lines: ${task['total_lines'] ?? lines.length} · '
                          'Bins: ${task['total_bin_locations'] ?? ''}'),
                      Text('Assigned: ${fmtDate(task['assigned_at'])}',
                          style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      const SizedBox(height: 10),
                      Wrap(spacing: 8, children: [
                        if (status == 'Pending Picker Acceptance' ||
                            status == 'Assigned to Picker' ||
                            status == 'Reminder Sent' ||
                            status == 'Escalated to Supervisor')
                          FilledButton.icon(
                            icon: const Icon(Icons.check_circle_outline),
                            label: const Text('Accept'),
                            onPressed: _busy ? null : () => _run(
                                () => api.post('/api/picking/tasks/${widget.taskId}/accept'),
                                ok: 'Task accepted.'),
                          ),
                        if (status == 'Accepted by Picker')
                          FilledButton.icon(
                            icon: const Icon(Icons.play_arrow),
                            label: const Text('Start picking'),
                            onPressed: _busy ? null : () => _run(
                                () => api.post('/api/picking/tasks/${widget.taskId}/start'),
                                ok: 'Picking started.'),
                          ),
                        if (status == 'Picking in Progress')
                          FilledButton.icon(
                            icon: const Icon(Icons.done_all),
                            label: const Text('Complete task'),
                            onPressed: _busy ? null : () => _run(
                                () => api.post('/api/picking/tasks/${widget.taskId}/complete'),
                                ok: 'Picking completed. Sent to GI.'),
                          ),
                      ]),
                    ],
                  ),
                ),
                ...lines.map((line) => _LineCard(
                      line: line,
                      allocations: allocations.where((a) => a['line_id'] == line['id']).toList(),
                      taskStarted: status == 'Picking in Progress',
                      onScan: (alloc, qr) => _run(
                          () => api.post('/api/picking/allocations/${alloc['id']}/scan', {'qr_value': qr}),
                          ok: 'QR validated.'),
                      onConfirm: (picked, reason) => _run(
                          () => api.post('/api/picking/lines/${line['id']}/confirm', {
                                'picked_quantity': picked,
                                if (reason != null) 'shortage_reason': reason,
                              }),
                          ok: 'Line confirmed.'),
                    )),
                const SizedBox(height: 24),
              ],
            );
          },
        ),
        if (_busy)
          const Positioned.fill(
            child: ColoredBox(color: Color(0x33000000), child: Center(child: CircularProgressIndicator())),
          ),
      ]),
    );
  }
}

class _LineCard extends StatelessWidget {
  const _LineCard({
    required this.line,
    required this.allocations,
    required this.taskStarted,
    required this.onScan,
    required this.onConfirm,
  });
  final Map<String, dynamic> line;
  final List<Map<String, dynamic>> allocations;
  final bool taskStarted;
  final void Function(Map<String, dynamic> alloc, String qr) onScan;
  final void Function(double picked, String? reason) onConfirm;

  @override
  Widget build(BuildContext context) {
    final approved = (line['approved_quantity'] ?? line['requested_quantity']) as num;
    final reserved = (line['reserved_quantity'] ?? 0) as num;
    final lineStatus = '${line['line_status']}';
    final open = allocations.where((a) =>
        a['status'] == 'PROPOSED' || a['status'] == 'SCANNED').toList();

    return SectionCard(
      title: '${line['line_number']}. ${line['material_code']}',
      trailing: StatusChip(lineStatus),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${line['material_description'] ?? ''}'),
          Text('Approved ${fmtQty(approved)} · Allocated ${fmtQty(reserved)} ${line['uom'] ?? ''}',
              style: const TextStyle(fontSize: 13, color: Colors.grey)),
          const SizedBox(height: 6),
          if (open.isEmpty)
            const Text('No open allocations for this line.', style: TextStyle(fontSize: 12, color: Colors.grey)),
          ...open.map((a) {
            final scanned = a['status'] == 'SCANNED';
            return ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(scanned ? Icons.check_circle : Icons.qr_code,
                  color: scanned ? const Color(0xFF1baf7a) : Colors.grey),
              title: Text('Batch ${a['batch_number'] ?? '—'} · Bin ${a['bin_location'] ?? '—'}'),
              subtitle: Text('Qty ${fmtQty(a['proposed_quantity'])}'),
              trailing: scanned
                  ? const Text('Scanned', style: TextStyle(color: Color(0xFF1baf7a), fontSize: 12))
                  : TextButton(
                      onPressed: taskStarted ? () => _scanDialog(context, a) : null,
                      child: const Text('Scan'),
                    ),
            );
          }),
          if (taskStarted && open.isNotEmpty)
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                icon: const Icon(Icons.inventory, size: 18),
                label: const Text('Confirm pick'),
                onPressed: () => _confirmDialog(context, approved.toDouble(), reserved.toDouble()),
              ),
            ),
        ],
      ),
    );
  }

  void _scanDialog(BuildContext context, Map<String, dynamic> alloc) {
    final ctrl = TextEditingController(text: '${alloc['scanned_qr_value'] ?? ''}');
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Scan / enter QR'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Batch ${alloc['batch_number'] ?? ''} · Bin ${alloc['bin_location'] ?? ''}',
                style: const TextStyle(fontSize: 12, color: Colors.grey)),
            const SizedBox(height: 10),
            TextField(
              controller: ctrl,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'QR value',
                helperText: 'Paste from a scanner app or type it',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (ctrl.text.trim().isEmpty) return;
              Navigator.pop(context);
              onScan(alloc, ctrl.text.trim());
            },
            child: const Text('Validate'),
          ),
        ],
      ),
    );
  }

  void _confirmDialog(BuildContext context, double approved, double reserved) {
    final ctrl = TextEditingController(text: '${reserved == reserved.roundToDouble() ? reserved.toInt() : reserved}');
    final reasonCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) {
          final picked = double.tryParse(ctrl.text.trim()) ?? 0;
          final isShort = picked < approved && picked > 0;
          return AlertDialog(
            title: Text('Confirm line ${line['line_number']}'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Approved: ${fmtQty(approved)} · Allocated: ${fmtQty(reserved)}',
                    style: const TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 10),
                TextField(
                  controller: ctrl,
                  autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Picked quantity', border: OutlineInputBorder()),
                  onChanged: (_) => setLocal(() {}),
                ),
                if (isShort) ...[
                  const SizedBox(height: 10),
                  TextField(
                    controller: reasonCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Shortage reason (required)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
              FilledButton(
                onPressed: () {
                  final p = double.tryParse(ctrl.text.trim());
                  if (p == null || p < 0) return;
                  if (p < approved && p > 0 && reasonCtrl.text.trim().isEmpty) return;
                  Navigator.pop(context);
                  onConfirm(p, isShort ? reasonCtrl.text.trim() : null);
                },
                child: const Text('Confirm'),
              ),
            ],
          );
        },
      ),
    );
  }
}
