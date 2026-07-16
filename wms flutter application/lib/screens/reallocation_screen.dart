import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Stock Reallocation — move batch stock between warehouses / bins / projects.
/// Reserved stock never moves; partial moves split the batch (new QR).
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
            title: Text(t('New reallocation')),
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
                  initialValue: toBin.isEmpty ? '' : toBin,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t('Target bin'), border: const OutlineInputBorder()),
                  items: [
                    DropdownMenuItem(value: '', child: Text(t('No bin / assign later'))),
                    ...bins.map((b) => DropdownMenuItem(
                        value: '${b['bin_code']}', child: Text('${b['bin_code']}'))),
                  ],
                  onChanged: (v) => toBin = v ?? '',
                ),
                const SizedBox(height: 10),
                TextField(controller: project,
                    decoration: InputDecoration(labelText: t('Project / WBS'), border: const OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(controller: reason,
                    decoration: InputDecoration(labelText: t('Reason'), border: const OutlineInputBorder())),
              ]),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: Text(t('Cancel'))),
              FilledButton(
                onPressed: () {
                  if (batch == null || double.tryParse(qty.text.trim()) == null) return;
                  Navigator.pop(context, true);
                },
                child: Text(t('Move stock')),
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

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _create,
        icon: const Icon(Icons.swap_horiz),
        label: Text(t('Reallocate')),
      ),
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
          return ListView.separated(
            itemCount: rows.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final m = rows[i];
              return ListTile(
                leading: const Icon(Icons.swap_horiz),
                title: Text('${m['realloc_number']} · ${m['material_code'] ?? ''}',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${m['batch_number'] ?? ''} · ${fmtQty(m['quantity'])}\n'
                    '${m['from_warehouse'] ?? ''}/${m['from_bin'] ?? '—'} → ${m['to_warehouse'] ?? ''}/${m['to_bin'] ?? '—'}'
                    '${(m['to_project'] ?? '').toString().isNotEmpty ? ' · ${m['to_project']}' : ''}'),
                isThreeLine: true,
                trailing: Text(fmtDate(m['created_at']),
                    style: const TextStyle(fontSize: 11, color: Colors.grey)),
              );
            },
          );
        },
      ),
    );
  }
}
