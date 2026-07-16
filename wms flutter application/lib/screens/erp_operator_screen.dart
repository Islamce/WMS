import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/i18n.dart';
import '../main.dart';
import '../widgets/common.dart';

/// ERP Operator queue: enter reservation/reference, movement type, plant,
/// storage location and issue warehouse (all mandatory), then route to the
/// warehouse. Mirrors POST /api/erp-operator/:id/send-to-warehouse guards.
class ErpOperatorScreen extends StatefulWidget {
  const ErpOperatorScreen({super.key});
  @override
  State<ErpOperatorScreen> createState() => _ErpOperatorScreenState();
}

class _ErpOperatorScreenState extends State<ErpOperatorScreen> {
  int _key = 0;

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<List<Map<String, dynamic>>>(
      key: ValueKey(_key),
      load: () async {
        final res = await session.api.get('/api/erp-operator');
        return List<Map<String, dynamic>>.from(
            (res['requests'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      },
      builder: (context, rows, refresh) {
        if (rows.isEmpty) {
          return ListView(children: const [
            SizedBox(height: 80),
            Center(child: Text('No requests in the ERP queue.', style: TextStyle(color: Colors.grey))),
          ]);
        }
        return ListView.separated(
          itemCount: rows.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final r = rows[i];
            final dept = (r['department'] ?? '').toString();
            final proj = (r['project'] ?? '').toString();
            return ListTile(
              title: Text('${r['request_number']}', style: const TextStyle(fontWeight: FontWeight.w600)),
              isThreeLine: dept.isNotEmpty || proj.isNotEmpty,
              subtitle: Text('${r['requester_name'] ?? ''} · ${r['priority'] ?? ''}'
                  '${(r['movement_type'] ?? '').toString().isNotEmpty ? ' · MvT ${r['movement_type']}' : ''}'
                  '${dept.isNotEmpty || proj.isNotEmpty ? '\n${[if (dept.isNotEmpty) dept, if (proj.isNotEmpty) proj, if ((r['cost_center'] ?? '').toString().isNotEmpty) r['cost_center'], if ((r['required_date'] ?? '').toString().isNotEmpty) 'req. ${r['required_date']}'].join(' · ')}' : ''}'),
              trailing: SizedBox(
                width: 120,
                child: Align(alignment: Alignment.centerRight, child: StatusChip('${r['request_status']}')),
              ),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => _ErpForm(requestId: r['id'] as int, requestNumber: '${r['request_number']}')));
                setState(() => _key++);
              },
            );
          },
        );
      },
    );
  }
}

class _ErpForm extends StatefulWidget {
  const _ErpForm({required this.requestId, required this.requestNumber});
  final int requestId;
  final String requestNumber;
  @override
  State<_ErpForm> createState() => _ErpFormState();
}

class _ErpFormState extends State<_ErpForm> {
  final _reservation = TextEditingController();
  final _storageLoc = TextEditingController();
  String? _movementType;
  String? _plant;
  String? _warehouse;
  Map<String, dynamic>? _meta;
  Map<String, dynamic> _header = {};
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final api = SessionScope.of(context).api;
      final meta = Map<String, dynamic>.from(await api.get('/api/meta'));
      final detail = Map<String, dynamic>.from(await api.get('/api/requests/${widget.requestId}'));
      final h = Map<String, dynamic>.from(detail['request'] ?? {});
      setState(() {
        _meta = meta;
        _header = h;
        _reservation.text = '${h['erp_reservation_number'] ?? ''}';
        _storageLoc.text = '${h['storage_location'] ?? ''}';
        _movementType = (h['movement_type'] ?? '').toString().isEmpty ? null : '${h['movement_type']}';
        _plant = (h['plant'] ?? '').toString().isEmpty ? null : '${h['plant']}';
        _warehouse = (h['issue_warehouse_code'] ?? '').toString().isEmpty ? null : '${h['issue_warehouse_code']}';
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) showSnack(context, '$e', error: true);
    }
  }

  List<Map<String, dynamic>> _list(String key) =>
      List<Map<String, dynamic>>.from((_meta?[key] ?? []).map((e) => Map<String, dynamic>.from(e)));

  Future<void> _save({required bool send}) async {
    setState(() => _busy = true);
    final api = SessionScope.of(context).api;
    try {
      await api.patch('/api/erp-operator/${widget.requestId}', {
        'erp_reservation_number': _reservation.text.trim(),
        'movement_type': _movementType,
        'plant': _plant,
        'storage_location': _storageLoc.text.trim(),
        'issue_warehouse_code': _warehouse,
      });
      if (send) {
        await api.post('/api/erp-operator/${widget.requestId}/send-to-warehouse');
      }
      if (mounted) {
        showSnack(context, send ? 'Sent to warehouse.' : 'ERP details saved.');
        if (send) Navigator.of(context).pop();
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reverse() async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t('Reverse one step')),
        content: TextField(
          controller: ctrl, autofocus: true, maxLines: 2,
          decoration: InputDecoration(
              labelText: t('Reason (releases any reservation, allocation or picking task this stage holds)'),
              border: const OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t('Cancel'))),
          FilledButton(
            onPressed: () => Navigator.pop(context, ctrl.text.trim()),
            child: Text(t('Reverse one step')),
          ),
        ],
      ),
    );
    if (reason == null) return;
    setState(() => _busy = true);
    try {
      final res = await SessionScope.of(context).api
          .post('/api/requests/${widget.requestId}/reverse', {'reason': reason});
      if (mounted) {
        showSnack(context, '${res['message'] ?? t('Request reversed.')}');
        Navigator.of(context).pop();
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('ERP · ${widget.requestNumber}'),
        actions: [
          IconButton(
            tooltip: t('Reverse one step'),
            icon: const Icon(Icons.keyboard_return_outlined),
            onPressed: _busy ? null : _reverse,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                RequestInfoCard(_header),
                SectionCard(
                  title: 'ERP details (all mandatory before routing)',
                  child: Column(
                    children: [
                      TextField(
                        controller: _reservation,
                        decoration: const InputDecoration(
                            labelText: 'ERP reservation / reference number', border: OutlineInputBorder()),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _movementType,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Movement type', border: OutlineInputBorder()),
                        items: _list('movementTypes')
                            .map((m) => DropdownMenuItem(
                                value: '${m['code']}',
                                child: Text('${m['code']} · ${m['description'] ?? ''}',
                                    overflow: TextOverflow.ellipsis)))
                            .toList(),
                        onChanged: (v) => setState(() => _movementType = v),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _plant,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Plant', border: OutlineInputBorder()),
                        items: _list('plants')
                            .map((p) => DropdownMenuItem(
                                value: '${p['code']}', child: Text('${p['code']} · ${p['label'] ?? ''}')))
                            .toList(),
                        onChanged: (v) => setState(() => _plant = v),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _storageLoc,
                        decoration: const InputDecoration(
                            labelText: 'Storage location', border: OutlineInputBorder()),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _warehouse,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Issue warehouse', border: OutlineInputBorder()),
                        items: _list('warehouses')
                            .map((w) => DropdownMenuItem(
                                value: '${w['warehouse_code']}',
                                child: Text('${w['warehouse_code']} · ${w['warehouse_name'] ?? ''}',
                                    overflow: TextOverflow.ellipsis)))
                            .toList(),
                        onChanged: (v) => setState(() => _warehouse = v),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.save_outlined),
                        label: const Text('Save'),
                        onPressed: _busy ? null : () => _save(send: false),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        icon: const Icon(Icons.warehouse),
                        label: const Text('Send to warehouse'),
                        onPressed: _busy ? null : () => _save(send: true),
                      ),
                    ),
                  ]),
                ),
              ],
            ),
    );
  }
}
