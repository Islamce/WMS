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

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<List<Map<String, dynamic>>>(
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
            ...rows.map((r) => Card(
                  margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: () async {
                      final changed = await Navigator.of(context).push<bool>(
                        MaterialPageRoute(
                          builder: (_) => ApprovalDetailScreen(
                              requestId: r['id'] as int),
                        ),
                      );
                      if (changed == true && mounted) setState(() => _key++);
                    },
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Expanded(
                              child: Text('${r['request_number']}',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 16)),
                            ),
                            StatusChip('${r['request_status']}'),
                            const SizedBox(width: 4),
                            const Icon(Icons.chevron_right, size: 18),
                          ]),
                          const SizedBox(height: 4),
                          Text('${r['requester_name'] ?? ''} · ${r['department'] ?? '—'} · '
                              '${r['priority'] ?? ''} · ${r['total_lines'] ?? 0} line(s)'),
                          Text('Submitted ${fmtDate(r['submitted_at'])}',
                              style: const TextStyle(
                                  fontSize: 12, color: Colors.grey)),
                          const SizedBox(height: 8),
                          const Text(
                            'Open to review materials, quantities and approve fully or partially.',
                            style: TextStyle(fontSize: 12, color: Colors.grey),
                          ),
                        ],
                      ),
                    ),
                  ),
                )),
          ],
        );
      },
    );
  }
}

class ApprovalDetailScreen extends StatefulWidget {
  const ApprovalDetailScreen({super.key, required this.requestId});
  final int requestId;

  @override
  State<ApprovalDetailScreen> createState() => _ApprovalDetailScreenState();
}

class _ApprovalDetailScreenState extends State<ApprovalDetailScreen> {
  int _key = 0;
  bool _busy = false;
  final Map<int, bool> _selected = {};
  final Map<int, TextEditingController> _qtyControllers = {};

  Future<Map<String, dynamic>> _load() async {
    final session = SessionScope.of(context);
    final data = Map<String, dynamic>.from(
        await session.api.get('/api/requests/${widget.requestId}'));
    final lines = List<Map<String, dynamic>>.from(
        (data['lines'] ?? []).map((e) => Map<String, dynamic>.from(e)));
    for (final line in lines) {
      final id = line['id'] as int;
      _selected.putIfAbsent(id, () => true);
      _qtyControllers.putIfAbsent(
        id,
        () => TextEditingController(
          text: fmtQty(line['approved_quantity'] ?? line['requested_quantity']),
        ),
      );
    }
    return data;
  }

  @override
  void dispose() {
    for (final c in _qtyControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<String?> _reason(String title, {bool required = true}) async {
    final ctrl = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          maxLines: 3,
          decoration: InputDecoration(
            labelText: required ? 'Reason (required)' : 'Comments (optional)',
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Back')),
          FilledButton(
            onPressed: () {
              final value = ctrl.text.trim();
              if (required && value.isEmpty) return;
              Navigator.pop(context, value);
            },
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    ctrl.dispose();
    return result;
  }

  Future<void> _saveQuantities(List<Map<String, dynamic>> lines) async {
    final session = SessionScope.of(context);
    for (final line in lines) {
      final id = line['id'] as int;
      if (_selected[id] != true) continue;
      final entered = double.tryParse(_qtyControllers[id]!.text.trim());
      final requested = double.tryParse('${line['requested_quantity']}') ?? 0;
      if (entered == null || entered <= 0 || entered > requested) {
        throw ApiException(400,
            'Approved quantity for ${line['material_code']} must be greater than zero and not exceed ${fmtQty(requested)}.');
      }
      final current = double.tryParse(
              '${line['approved_quantity'] ?? line['requested_quantity']}') ??
          requested;
      if ((entered - current).abs() > 0.000001) {
        await session.api.patch(
          '/api/approvals/${widget.requestId}/lines/$id',
          {
            'approved_quantity': entered,
            'reason': 'Quantity adjusted during mobile approval',
          },
        );
      }
    }
  }

  Future<void> _decide(
      String decision, List<Map<String, dynamic>> lines) async {
    final session = SessionScope.of(context);
    String? reason;
    String? comments;
    if (decision == 'reject' || decision == 'return') {
      reason = await _reason(
          decision == 'reject' ? 'Reject request' : 'Return to requester');
      if (reason == null) return;
    } else {
      comments = await _reason(
        decision == 'partial' ? 'Partial approval' : 'Approve request',
        required: false,
      );
      if (comments == null) return;
    }

    setState(() => _busy = true);
    try {
      if (decision == 'approve' || decision == 'partial') {
        await _saveQuantities(lines);
      }
      final approvedIds = lines
          .where((l) => _selected[l['id'] as int] == true)
          .map((l) => l['id'] as int)
          .toList();
      if (decision == 'partial' && approvedIds.isEmpty) {
        throw ApiException(400, 'Select at least one material line.');
      }
      await session.api.post('/api/approvals/${widget.requestId}/decision', {
        'decision': decision,
        if (reason != null) 'reason': reason,
        if (comments != null && comments.isNotEmpty) 'comments': comments,
        if (decision == 'partial') 'approvedLineIds': approvedIds,
      });
      if (!mounted) return;
      showSnack(
          context,
          decision == 'approve'
              ? 'Request approved.'
              : decision == 'partial'
                  ? 'Request partially approved.'
                  : decision == 'reject'
                      ? 'Request rejected.'
                      : 'Request returned to requester.');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Approval Detail')),
      body: Stack(
        children: [
          AsyncView<Map<String, dynamic>>(
            key: ValueKey(_key),
            load: _load,
            builder: (context, data, refresh) {
              final h = Map<String, dynamic>.from(data['request'] ?? {});
              final lines = List<Map<String, dynamic>>.from(
                  (data['lines'] ?? [])
                      .map((e) => Map<String, dynamic>.from(e)));
              final selectedCount = lines
                  .where((l) => _selected[l['id'] as int] == true)
                  .length;
              return ListView(
                padding: const EdgeInsets.only(bottom: 24),
                children: [
                  SectionCard(
                    title: '${h['request_number']}',
                    trailing: StatusChip('${h['request_status']}'),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _kv('Requester', h['requester_name']),
                        _kv('Department', h['department']),
                        _kv('Priority', h['priority']),
                        _kv('Required date', h['required_date']),
                        _kv('Purpose', h['purpose']),
                        _kv('Plant', h['plant']),
                        _kv('Cost center', h['cost_center']),
                        _kv('WBS element', h['wbs_element']),
                      ],
                    ),
                  ),
                  SectionCard(
                    title: 'Materials (${lines.length})',
                    trailing: Text('$selectedCount selected'),
                    child: Column(
                      children: lines.map((line) {
                        final id = line['id'] as int;
                        final requested = line['requested_quantity'];
                        return Card(
                          margin: const EdgeInsets.only(bottom: 10),
                          child: Padding(
                            padding: const EdgeInsets.all(10),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                CheckboxListTile(
                                  value: _selected[id] ?? true,
                                  contentPadding: EdgeInsets.zero,
                                  controlAffinity:
                                      ListTileControlAffinity.leading,
                                  title: Text(
                                    '${line['material_code']} · ${line['material_description'] ?? ''}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w600),
                                  ),
                                  subtitle: Text(
                                      'Requested ${fmtQty(requested)} ${line['uom'] ?? ''}'),
                                  onChanged: _busy
                                      ? null
                                      : (v) => setState(
                                          () => _selected[id] = v ?? false),
                                ),
                                TextField(
                                  controller: _qtyControllers[id],
                                  enabled: !_busy && (_selected[id] ?? true),
                                  keyboardType: const TextInputType.numberWithOptions(
                                      decimal: true),
                                  decoration: InputDecoration(
                                    labelText: 'Approved quantity',
                                    helperText:
                                        'Maximum ${fmtQty(requested)} ${line['uom'] ?? ''}',
                                    border: const OutlineInputBorder(),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Column(
                      children: [
                        Row(children: [
                          Expanded(
                            child: FilledButton.icon(
                              icon: const Icon(Icons.check_circle_outline),
                              label: const Text('Approve all'),
                              onPressed: _busy
                                  ? null
                                  : () => _decide('approve', lines),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: FilledButton.tonalIcon(
                              icon: const Icon(Icons.rule_folder_outlined),
                              label: const Text('Approve selected'),
                              onPressed: _busy
                                  ? null
                                  : () => _decide('partial', lines),
                            ),
                          ),
                        ]),
                        const SizedBox(height: 8),
                        Row(children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              icon: const Icon(Icons.undo),
                              label: const Text('Return'),
                              onPressed: _busy
                                  ? null
                                  : () => _decide('return', lines),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton.icon(
                              icon: const Icon(Icons.close),
                              label: const Text('Reject'),
                              style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.red),
                              onPressed: _busy
                                  ? null
                                  : () => _decide('reject', lines),
                            ),
                          ),
                        ]),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
          if (_busy)
            const Positioned.fill(
              child: ColoredBox(
                color: Color(0x33000000),
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
        ],
      ),
    );
  }

  Widget _kv(String label, dynamic value) {
    final text = value == null || value.toString().isEmpty ? '—' : '$value';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 110,
              child: Text(label,
                  style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(text)),
        ],
      ),
    );
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
              (res['thresholds'] ?? [])
                  .map((e) => Map<String, dynamic>.from(e)));
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
                  Icon(Icons.gavel_outlined,
                      size: 18, color: Color(0xFF9a6a00)),
                  SizedBox(width: 6),
                  Text('Approval authority',
                      style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF9a6a00))),
                ]),
                const SizedBox(height: 6),
                ...rows.map((t) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Text(
                        '≥ ${t['min_amount']} ${t['currency'] ?? ''} → needs "${t['required_permission']}"',
                        style: const TextStyle(
                            fontSize: 13, color: Color(0xFF6b5200)),
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
