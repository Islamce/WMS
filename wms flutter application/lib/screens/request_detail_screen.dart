import 'dart:convert';

import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../main.dart';
import '../widgets/common.dart';

class RequestDetailScreen extends StatefulWidget {
  const RequestDetailScreen({super.key, required this.requestId});
  final int requestId;
  @override
  State<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends State<RequestDetailScreen> {
  int _reloadKey = 0;
  bool _busy = false;

  Future<Map<String, dynamic>> _load() async {
    final session = SessionScope.of(context);
    return Map<String, dynamic>.from(await session.api.get('/api/requests/${widget.requestId}'));
  }

  Future<void> _action(String path, {Object? body, required String ok}) async {
    final session = SessionScope.of(context);
    setState(() => _busy = true);
    try {
      await session.api.post(path, body);
      if (mounted) {
        showSnack(context, ok);
        setState(() => _reloadKey++);
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
    return Scaffold(
      appBar: AppBar(title: const Text('Request Detail')),
      body: AsyncView<Map<String, dynamic>>(
        key: ValueKey(_reloadKey),
        load: _load,
        builder: (context, data, refresh) {
          final h = Map<String, dynamic>.from(data['request'] ?? {});
          final lines = List<Map<String, dynamic>>.from(
              (data['lines'] ?? []).map((e) => Map<String, dynamic>.from(e)));
          final status = '${h['request_status']}';
          final isOwner = h['requester_id'] == session.user?['id'];
          final canSubmit = status == 'Draft' || status == 'Returned to Requester';
          final canCancel = !['Completed', 'Cancelled', 'Rejected', 'Closed with Shortage', 'Partially Completed']
              .contains(status);
          final canReverse = ['Completed', 'Partially Completed', 'Closed with Shortage'].contains(status)
              && session.can('gi_posting');
          final canAttach = session.can(['material_requests', 'create_request', 'approvals']);

          return ListView(
            children: [
              SectionCard(
                title: '${h['request_number']}',
                trailing: StatusChip(status),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _kv('Requester', h['requester_name']),
                    _kv('Department', h['department']),
                    _kv('Priority', h['priority']),
                    _kv('Required date', h['required_date']),
                    _kv('Plant', h['plant']),
                    _kv('Movement type', h['movement_type']),
                    _kv('Issue warehouse', h['issue_warehouse_code']),
                    _kv('ERP reservation', h['erp_reservation_number']),
                    if ((h['purpose'] ?? '').toString().isNotEmpty) _kv('Purpose', h['purpose']),
                    _kv('Created', fmtDate(h['created_at'])),
                  ],
                ),
              ),
              SectionCard(
                title: 'Lines (${lines.length})',
                child: Column(
                  children: lines.map((l) {
                    final req = l['requested_quantity'];
                    final app = l['approved_quantity'];
                    final picked = l['picked_quantity'];
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text('${l['line_number']}. ${l['material_code']} · ${l['material_description'] ?? ''}',
                                    style: const TextStyle(fontWeight: FontWeight.w600),
                                    maxLines: 2, overflow: TextOverflow.ellipsis),
                              ),
                              StatusChip('${l['line_status']}'),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Req ${fmtQty(req)}${app != null ? ' · Appr ${fmtQty(app)}' : ''}'
                            '${picked != null && picked != 0 ? ' · Picked ${fmtQty(picked)}' : ''} ${l['uom'] ?? ''}',
                            style: const TextStyle(fontSize: 13, color: Colors.grey),
                          ),
                          const Divider(),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
              if (canAttach) _AttachmentsCard(requestId: widget.requestId, session: session),
              if (canReverse)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.undo_rounded),
                    label: const Text('Reverse Goods Issue'),
                    style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFFeda100)),
                    onPressed: _busy ? null : () => _reverse(),
                  ),
                ),
              if (isOwner && (canSubmit || canCancel))
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      if (canSubmit)
                        Expanded(
                          child: FilledButton.icon(
                            icon: const Icon(Icons.send),
                            label: const Text('Submit'),
                            onPressed: _busy ? null : () => _action(
                                '/api/requests/${widget.requestId}/submit',
                                ok: 'Request submitted for approval.'),
                          ),
                        ),
                      if (canSubmit && canCancel) const SizedBox(width: 10),
                      if (canCancel)
                        Expanded(
                          child: OutlinedButton.icon(
                            icon: const Icon(Icons.cancel_outlined),
                            label: const Text('Cancel'),
                            onPressed: _busy ? null : () => _cancel(),
                          ),
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 20),
            ],
          );
        },
      ),
    );
  }

  Future<void> _cancel() async {
    final reason = await _askReason(context, 'Cancel request', 'Reason for cancellation');
    if (reason == null) return;
    await _action('/api/requests/${widget.requestId}/cancel',
        body: {'reason': reason}, ok: 'Request cancelled.');
  }

  Future<void> _reverse() async {
    final reason = await _askReason(context, 'Reverse Goods Issue',
        'Reason (stock returns to its batches)');
    if (reason == null) return;
    await _action('/api/gi/${widget.requestId}/reverse',
        body: {'reason': reason}, ok: 'Goods issue reversed.');
  }

  Widget _kv(String k, dynamic v) {
    final val = (v == null || v.toString().isEmpty) ? '—' : v.toString();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 130, child: Text(k, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(val)),
        ],
      ),
    );
  }
}

/// Shared reason prompt used by cancel / reject / return / shortage flows.
Future<String?> _askReason(BuildContext context, String title, String label) {
  final ctrl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: ctrl,
        autofocus: true,
        maxLines: 3,
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
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
}

/// Attachments panel: lists documents on a request, lets the user add a text
/// note as an attachment and delete one. (File/photo upload is on the web app;
/// mobile stays dependency-free.)
class _AttachmentsCard extends StatefulWidget {
  const _AttachmentsCard({required this.requestId, required this.session});
  final int requestId;
  final Session session;

  @override
  State<_AttachmentsCard> createState() => _AttachmentsCardState();
}

class _AttachmentsCardState extends State<_AttachmentsCard> {
  int _key = 0;
  bool _busy = false;

  Future<List<Map<String, dynamic>>> _load() async {
    final res = await widget.session.api.get('/api/requests/${widget.requestId}/attachments');
    return List<Map<String, dynamic>>.from(
        (res['attachments'] ?? []).map((e) => Map<String, dynamic>.from(e)));
  }

  Future<void> _addNote() async {
    final ctrl = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add note attachment'),
        content: TextField(
          controller: ctrl, autofocus: true, maxLines: 5,
          decoration: const InputDecoration(
              labelText: 'Note text', border: OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Back')),
          FilledButton(
            onPressed: () {
              if (ctrl.text.trim().isEmpty) return;
              Navigator.pop(context, ctrl.text.trim());
            },
            child: const Text('Attach'),
          ),
        ],
      ),
    );
    if (text == null) return;
    setState(() => _busy = true);
    try {
      final stamp = DateTime.now().toIso8601String().replaceAll(RegExp(r'[:.]'), '-');
      await widget.session.api.post('/api/requests/${widget.requestId}/attachments', {
        'file_name': 'note-$stamp.txt',
        'content_type': 'text/plain',
        'data_base64': base64Encode(utf8.encode(text)),
      });
      if (mounted) { showSnack(context, 'Note attached.'); setState(() => _key++); }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(int id) async {
    setState(() => _busy = true);
    try {
      await widget.session.api.delete('/api/attachments/$id');
      if (mounted) { showSnack(context, 'Attachment deleted.'); setState(() => _key++); }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Attachments',
      trailing: TextButton.icon(
        icon: const Icon(Icons.note_add_outlined, size: 18),
        label: const Text('Add note'),
        onPressed: _busy ? null : _addNote,
      ),
      child: FutureBuilder<List<Map<String, dynamic>>>(
        key: ValueKey(_key),
        future: _load(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Padding(
                padding: EdgeInsets.all(8), child: LinearProgressIndicator());
          }
          if (snap.hasError) {
            return Text('${snap.error}', style: const TextStyle(color: Colors.grey));
          }
          final items = snap.data ?? [];
          if (items.isEmpty) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: Text('No attachments.', style: TextStyle(color: Colors.grey)),
            );
          }
          return Column(
            children: items.map((a) {
              final kb = ((a['byte_size'] ?? 0) as num) / 1024;
              return ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.insert_drive_file_outlined),
                title: Text('${a['file_name']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text('${kb.toStringAsFixed(0)} KB · ${a['uploaded_by_name'] ?? ''}'),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline, color: Color(0xFFe34948)),
                  onPressed: _busy ? null : () => _delete(a['id'] as int),
                ),
              );
            }).toList(),
          );
        },
      ),
    );
  }
}
