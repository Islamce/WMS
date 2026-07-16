import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Physical Inventory — annual / periodic counting sessions with blind counts,
/// recounts, variance approval and adjustment posting.
class InventoryScreen extends StatefulWidget {
  const InventoryScreen({super.key});
  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  int _key = 0;

  Future<void> _create() async {
    final api = SessionScope.of(context).api;
    List<Map<String, dynamic>> warehouses = [];
    try {
      final meta = await api.get('/api/meta');
      warehouses = List<Map<String, dynamic>>.from(
          (meta['warehouses'] ?? []).map((e) => Map<String, dynamic>.from(e)));
    } catch (_) {}
    if (!mounted || warehouses.isEmpty) return;

    String type = 'ANNUAL';
    String warehouse = '${warehouses.first['warehouse_code']}';
    bool blind = true, freeze = true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(t('New count session')),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: type,
              decoration: InputDecoration(labelText: t('Type'), border: const OutlineInputBorder()),
              items: [
                DropdownMenuItem(value: 'ANNUAL', child: Text(t('Annual inventory'))),
                DropdownMenuItem(value: 'PERIODIC', child: Text(t('Periodic inventory'))),
                DropdownMenuItem(value: 'CYCLE', child: Text(t('Cycle (ad hoc)'))),
              ],
              onChanged: (v) => setLocal(() => type = v ?? 'ANNUAL'),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: warehouse,
              isExpanded: true,
              decoration: InputDecoration(labelText: t('Warehouse'), border: const OutlineInputBorder()),
              items: warehouses
                  .map((w) => DropdownMenuItem(
                      value: '${w['warehouse_code']}',
                      child: Text('${w['warehouse_code']} · ${w['warehouse_name'] ?? ''}',
                          overflow: TextOverflow.ellipsis)))
                  .toList(),
              onChanged: (v) => setLocal(() => warehouse = v ?? warehouse),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: blind,
              onChanged: (v) => setLocal(() => blind = v ?? true),
              title: Text(t('Blind count'), style: const TextStyle(fontSize: 14)),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: freeze,
              onChanged: (v) => setLocal(() => freeze = v ?? true),
              title: Text(t('Freeze stock while counting'), style: const TextStyle(fontSize: 14)),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: Text(t('Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(t('Open session'))),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final r = await api.post('/api/inventory',
          {'session_type': type, 'warehouse_code': warehouse, 'blind': blind, 'freeze_stock': freeze});
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
        icon: const Icon(Icons.add),
        label: Text(t('Count session')),
      ),
      body: AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_key),
        load: () async {
          final res = await session.api.get('/api/inventory');
          return List<Map<String, dynamic>>.from(
              (res['sessions'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, rows, refresh) {
          if (rows.isEmpty) {
            return ListView(children: [
              const SizedBox(height: 80),
              Center(child: Text(t('No inventory sessions yet'), style: const TextStyle(color: Colors.grey))),
            ]);
          }
          return ListView.separated(
            itemCount: rows.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final s = rows[i];
              return ListTile(
                title: Text('${s['session_number']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${s['session_type']} · ${s['warehouse_code']} · '
                    '${s['counted_lines']}/${s['total_lines']} ${t('counted')}'
                    '${(s['freeze_stock'] ?? 0) == 1 ? ' · 🧊' : ''}\n${fmtDate(s['created_at'])}'),
                isThreeLine: true,
                trailing: StatusChip('${s['status']}'),
                onTap: () async {
                  await Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => _SessionDetail(sessionId: s['id'] as int)));
                  setState(() => _key++);
                },
              );
            },
          );
        },
      ),
    );
  }
}

class _SessionDetail extends StatefulWidget {
  const _SessionDetail({required this.sessionId});
  final int sessionId;
  @override
  State<_SessionDetail> createState() => _SessionDetailState();
}

class _SessionDetailState extends State<_SessionDetail> {
  int _key = 0;
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) setState(() => _key++);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _count(Map<String, dynamic> line) async {
    final ctrl = TextEditingController();
    final qty = await showDialog<double>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${line['batch_number']}'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: t('Counted quantity'), border: const OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t('Cancel'))),
          FilledButton(
            onPressed: () {
              final v = double.tryParse(ctrl.text.trim());
              if (v == null || v < 0) return;
              Navigator.pop(context, v);
            },
            child: Text(t('Record count')),
          ),
        ],
      ),
    );
    if (qty == null) return;
    await _run(() async {
      final api = SessionScope.of(context).api;
      await api.post('/api/inventory/lines/${line['id']}/count', {'counted_quantity': qty});
      if (mounted) showSnack(context, t('Count recorded.'));
    });
  }

  @override
  Widget build(BuildContext context) {
    final api = SessionScope.of(context).api;
    return Scaffold(
      appBar: AppBar(title: Text(t('Physical Inventory'))),
      body: Stack(children: [
        AsyncView<Map<String, dynamic>>(
          key: ValueKey(_key),
          load: () async => Map<String, dynamic>.from(await api.get('/api/inventory/${widget.sessionId}')),
          builder: (context, data, refresh) {
            final s = Map<String, dynamic>.from(data['session'] ?? {});
            final lines = List<Map<String, dynamic>>.from(
                (data['lines'] ?? []).map((e) => Map<String, dynamic>.from(e)));
            final status = '${s['status']}';
            final counting = status == 'COUNTING';
            return ListView(
              children: [
                SectionCard(
                  title: '${s['session_number']}',
                  trailing: StatusChip(status),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${s['session_type']} · ${s['warehouse_code']}'
                          '${(s['blind'] ?? 0) == 1 ? ' · ${t('blind count')}' : ''}'
                          '${(s['freeze_stock'] ?? 0) == 1 && (counting || status == 'REVIEW') ? ' · 🧊 ${t('warehouse frozen')}' : ''}'),
                      const SizedBox(height: 10),
                      Wrap(spacing: 8, runSpacing: 6, children: [
                        if (counting)
                          FilledButton.icon(
                            icon: const Icon(Icons.fact_check_outlined, size: 18),
                            label: Text(t('Move to review')),
                            onPressed: _busy ? null : () => _run(() async {
                              final r = await api.post('/api/inventory/${widget.sessionId}/review');
                              if (mounted) showSnack(context, '${r['message']}');
                            }),
                          ),
                        if (counting || status == 'REVIEW') ...[
                          FilledButton.icon(
                            icon: const Icon(Icons.done_all, size: 18),
                            label: Text(t('Post adjustments')),
                            onPressed: _busy ? null : () => _run(() async {
                              final r = await api.post('/api/inventory/${widget.sessionId}/post');
                              if (mounted) showSnack(context, '${r['message']}');
                            }),
                          ),
                          OutlinedButton.icon(
                            icon: const Icon(Icons.cancel_outlined, size: 18),
                            label: Text(t('Cancel session')),
                            onPressed: _busy ? null : () => _run(() async {
                              final r = await api.post('/api/inventory/${widget.sessionId}/cancel');
                              if (mounted) showSnack(context, '${r['message']}');
                            }),
                          ),
                        ],
                      ]),
                    ],
                  ),
                ),
                ...lines.map((l) {
                  final lineStatus = '${l['status']}';
                  final sysQty = l['system_quantity'];
                  final counted = l['recount_quantity'] ?? l['counted_quantity'];
                  return ListTile(
                    dense: true,
                    title: Text('${l['batch_number']} · ${l['material_code']}'),
                    subtitle: Text('${t('Bin')} ${l['bin_location'] ?? '—'}'
                        ' · ${t('System')}: ${sysQty == null ? '🔒' : fmtQty(sysQty)}'
                        '${counted != null ? ' · ${t('Counted')}: ${fmtQty(counted)}' : ''}'
                        '${l['variance'] != null ? ' · Δ ${fmtQty(l['variance'])}' : ''}'),
                    trailing: counting && (lineStatus == 'PENDING' || lineStatus == 'RECOUNT')
                        ? TextButton(onPressed: () => _count(l), child: Text(t('Count')))
                        : counting && lineStatus == 'COUNTED'
                            ? Wrap(children: [
                                TextButton(
                                  onPressed: _busy ? null : () => _run(() async {
                                    await api.post('/api/inventory/lines/${l['id']}/approve');
                                  }),
                                  child: Text(t('Approve')),
                                ),
                                TextButton(
                                  onPressed: _busy ? null : () => _run(() async {
                                    await api.post('/api/inventory/lines/${l['id']}/recount');
                                  }),
                                  child: Text(t('Recount')),
                                ),
                              ])
                            : StatusChip(lineStatus),
                  );
                }),
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
