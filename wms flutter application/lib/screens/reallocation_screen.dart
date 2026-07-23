import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Governed stock reallocation: request → approval/rejection → execution.
class ReallocationScreen extends StatefulWidget {
  const ReallocationScreen({super.key});
  @override
  State<ReallocationScreen> createState() => _ReallocationScreenState();
}

class _ReallocationScreenState extends State<ReallocationScreen> {
  int _key = 0;

  Future<void> _create() async {
    final api = SessionScope.of(context).api;
    Map<String, dynamic>? meta;
    try {
      meta = Map<String, dynamic>.from(await api.get('/api/meta'));
    } catch (_) {}
    if (!mounted || meta == null) return;
    final warehouses = List<Map<String, dynamic>>.from(
        (meta['warehouses'] ?? []).map((e) => Map<String, dynamic>.from(e)));
    if (warehouses.isEmpty) return;

    Map<String, dynamic>? batch;
    List<Map<String, dynamic>> found = [];
    List<Map<String, dynamic>> bins = [];
    String toWarehouse = '${warehouses.first['warehouse_code']}';
    String toBin = '';
    try {
      final res = await api.get('/api/meta/warehouses/$toWarehouse/bins');
      bins = List<Map<String, dynamic>>.from(
          (res['bins'] ?? []).map((e) => Map<String, dynamic>.from(e)));
    } catch (_) {}
    if (!mounted) return;
    final search = TextEditingController();
    final qty = TextEditingController();
    final project = TextEditingController();
    final reason = TextEditingController();

    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) {
          Future<void> loadBins() async {
            try {
              final res = await api.get('/api/meta/warehouses/$toWarehouse/bins');
              bins = List<Map<String, dynamic>>.from(
                  (res['bins'] ?? []).map((e) => Map<String, dynamic>.from(e)));
            } catch (_) {
              bins = [];
            }
            setLocal(() {});
          }

          return AlertDialog(
            title: Text(t('New reallocation request')),
            content: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                TextField(
                  controller: search,
                  decoration: InputDecoration(
                      labelText: t('Search batch / material'),
                      suffixIcon: IconButton(
                        icon: const Icon(Icons.search),
                        onPressed: () async {
                          try {
                            final res = await api.get(
                                '/api/master/batches?search=${Uri.encodeComponent(search.text.trim())}&limit=6');
                            found = List<Map<String, dynamic>>.from(
                                (res['batches'] ?? []).map((e) => Map<String, dynamic>.from(e)));
                          } catch (_) {
                            found = [];
                          }
                          setLocal(() {});
                        },
                      ),
                      border: const OutlineInputBorder()),
                ),
                ...found.map((b) => ListTile(
                      dense: true,
                      title: Text('${b['batch_number']} · ${b['material_code']}'),
                      subtitle: Text('${fmtQty(b['remaining_quantity'])} @ ${b['warehouse_code']}/${b['bin_location'] ?? '—'}'),
                      selected: batch != null && batch!['id'] == b['id'],
                      onTap: () => setLocal(() {
                        batch = b;
                        final movable = (b['remaining_quantity'] as num) - ((b['reserved_quantity'] ?? 0) as num);
                        qty.text = '$movable';
                        found = [b];
                      }),
                    )),
                const SizedBox(height: 10),
                TextField(
                  controller: qty,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: t('Quantity to move'), border: const OutlineInputBorder()),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: toWarehouse,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t('Target warehouse'), border: const OutlineInputBorder()),
                  items: warehouses
                      .map((w) => DropdownMenuItem(
                          value: '${w['warehouse_code']}',
                          child: Text('${w['warehouse_code']} · ${w['warehouse_name'] ?? ''}',
                              overflow: TextOverflow.ellipsis)))
                      .toList(),
                  onChanged: (v) {
                    toWarehouse = v ?? toWarehouse;
                    toBin = '';
                    loadBins();
                  },
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: '',
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t('Target bin'), border: const OutlineInputBorder()),
                  items: [
                    DropdownMenuItem(value: '', child: Text(t('No bin / assign later'))),
                    ...bins.map((b) => DropdownMenuItem(value: '${b['bin_code']}', child: Text('${b['bin_code']}'))),
                  ],
                  onChanged: (v) => toBin = v ?? '',
                ),
                const SizedBox(height: 10),
                TextField(controller: project,
                    decoration: InputDecoration(labelText: t('Project / WBS'), border: const OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(controller: reason, maxLines: 2,
                    decoration: InputDecoration(labelText: t('Mandatory business reason'), border: const OutlineInputBorder())),
              ]),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: Text(t('Cancel'))),
              FilledButton(
                onPressed: () {
                  if (batch == null || double.tryParse(qty.text.trim()) == null || reason.text.trim().isEmpty) return;
                  Navigator.pop(context, true);
                },
                child: Text(t('Submit for approval')),
              ),
            ],
          );
        },
      ),
    );
    if (ok != true || batch == null) return;
    try {
      final r = await api.post('/api/reallocation', {
        'batch_id': batch!['id'],
        'quantity': double.parse(qty.text.trim()),
        'to_warehouse': toWarehouse,
        'to_bin': toBin,
        'to_project': project.text.trim(),
        'reason': reason.text.trim(),
      });
      if (mounted) {
        showSnack(context, '${r['message']}');
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _action(Map<String, dynamic> move, String action) async {
    final api = SessionScope.of(context).api;
    String? reason;
    if (action == 'reject') {
      final controller = TextEditingController();
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(t('Reject reallocation')),
          content: TextField(controller: controller, maxLines: 3,
              decoration: InputDecoration(labelText: t('Rejection reason'), border: const OutlineInputBorder())),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: Text(t('Cancel'))),
            FilledButton(onPressed: () {
              if (controller.text.trim().isNotEmpty) Navigator.pop(context, true);
            }, child: Text(t('Reject'))),
          ],
        ),
      );
      if (ok != true) return;
      reason = controller.text.trim();
    }
    try {
      final r = await api.post('/api/reallocation/${move['id']}/$action',
          action == 'reject' ? {'reason': reason} : null);
      if (mounted) {
        showSnack(context, '${r['message']}');
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'EXECUTED': return Colors.green;
      case 'APPROVED': return Colors.blue;
      case 'REJECTED': return Colors.red;
      case 'EXECUTING': return Colors.orange;
      default: return Colors.amber.shade800;
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final canRequest = session.can('reallocation');
    final canApprove = session.can('bin_batch_assignment');
    return Scaffold(
      floatingActionButton: canRequest
          ? FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.swap_horiz), label: Text(t('Request reallocation')))
          : null,
      body: AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_key),
        load: () async {
          final res = await session.api.get('/api/reallocation');
          return List<Map<String, dynamic>>.from(
              (res['moves'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, rows, refresh) {
          if (rows.isEmpty) {
            return ListView(children: [
              const SizedBox(height: 80),
              Center(child: Text(t('No reallocations yet'), style: const TextStyle(color: Colors.grey))),
            ]);
          }
          return RefreshIndicator(
            onRefresh: () async => refresh(),
            child: ListView.separated(
              itemCount: rows.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final m = rows[i];
                final status = '${m['status'] ?? 'EXECUTED'}';
                final actions = <Widget>[];
                if (canApprove && status == 'PENDING_APPROVAL') {
                  actions.add(TextButton(onPressed: () => _action(m, 'approve'), child: Text(t('Approve'))));
                  actions.add(TextButton(onPressed: () => _action(m, 'reject'), child: Text(t('Reject'))));
                } else if (canApprove && status == 'APPROVED') {
                  actions.add(FilledButton.tonal(onPressed: () => _action(m, 'execute'), child: Text(t('Execute'))));
                }
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(children: [
                    ListTile(
                      leading: const Icon(Icons.swap_horiz),
                      title: Text('${m['realloc_number']} · ${m['material_code'] ?? ''}',
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('${m['batch_number'] ?? ''} · ${fmtQty(m['quantity'])}\n'
                          '${m['from_warehouse'] ?? ''}/${m['from_bin'] ?? '—'} → ${m['to_warehouse'] ?? ''}/${m['to_bin'] ?? '—'}'
                          '${(m['to_project'] ?? '').toString().isNotEmpty ? ' · ${m['to_project']}' : ''}\n'
                          '${m['reason'] ?? ''}'),
                      isThreeLine: true,
                      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Chip(label: Text(status, style: const TextStyle(fontSize: 10)),
                            side: BorderSide(color: _statusColor(status))),
                        Text(fmtDate(m['created_at']), style: const TextStyle(fontSize: 10, color: Colors.grey)),
                      ]),
                    ),
                    if (actions.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(left: 16, right: 16, bottom: 6),
                        child: Row(mainAxisAlignment: MainAxisAlignment.end, children: actions),
                      ),
                  ]),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
