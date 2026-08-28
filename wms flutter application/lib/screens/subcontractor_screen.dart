import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Subcontractor Materials — the SAP-free site receiving stream (web PRs
/// #96-#99). Site Warehouse Supervisor logs a delivery, Site Quality
/// Supervisor decides each line (approval posts stock immediately, no
/// separate "receive" step), the Supervisor later logs consumption, and
/// Reconciliation shows received/consumed/remaining. No item code, no
/// material master — everything is free-text description/qty/category.
class SubcontractorScreen extends StatelessWidget {
  const SubcontractorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final canLog = session.can('subcontractor_receiving');
    return DefaultTabController(
      length: 3,
      child: Column(children: [
        const TabBar(tabs: [
          Tab(text: 'Deliveries'),
          Tab(text: 'On Hand'),
          Tab(text: 'Reconciliation'),
        ]),
        Expanded(
          child: TabBarView(children: [
            _DeliveriesTab(canLog: canLog),
            const _StockTab(),
            const _ReconciliationTab(),
          ]),
        ),
      ]),
    );
  }
}

// --- Deliveries & Quality ----------------------------------------------------
class _DeliveriesTab extends StatefulWidget {
  const _DeliveriesTab({required this.canLog});
  final bool canLog;
  @override
  State<_DeliveriesTab> createState() => _DeliveriesTabState();
}

class _DeliveriesTabState extends State<_DeliveriesTab> {
  int _key = 0;
  void _refresh() => setState(() => _key++);

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Stack(children: [
      AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_key),
        load: () async {
          final res = await session.api.get('/api/subcontractor/deliveries?page=1');
          return List<Map<String, dynamic>>.from(
              (res['deliveries'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, rows, refresh) {
          if (rows.isEmpty) {
            return ListView(children: const [
              SizedBox(height: 80),
              Center(child: Text('No deliveries logged yet.', style: TextStyle(color: Colors.grey))),
            ]);
          }
          return ListView(
            children: rows.map((d) {
              final status = d['status'] as String;
              return Card(
                margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: ListTile(
                  title: Text('DEL-${d['id']} · ${d['subcontractor_name']}',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text('${d['warehouse_code']} · delivered ${d['delivered_date']}\n'
                      '${d['line_count']} line(s)${(d['pending_lines'] ?? 0) > 0 ? ' — ${d['pending_lines']} pending' : ''}'),
                  isThreeLine: true,
                  trailing: StatusChip(status),
                  onTap: () => Navigator.push(context, MaterialPageRoute(
                    builder: (_) => _DeliveryDetailScreen(deliveryId: d['id'] as int),
                  )).then((_) => refresh()),
                ),
              );
            }).toList(),
          );
        },
      ),
      if (widget.canLog)
        Positioned(
          right: 16, bottom: 16,
          child: FloatingActionButton.extended(
            icon: const Icon(Icons.add),
            label: const Text('Log Delivery'),
            onPressed: () async {
              final created = await Navigator.push<bool>(context, MaterialPageRoute(
                builder: (_) => const _LogDeliveryScreen(),
              ));
              if (created == true) _refresh();
            },
          ),
        ),
    ]);
  }
}

class _LogDeliveryScreen extends StatefulWidget {
  const _LogDeliveryScreen();
  @override
  State<_LogDeliveryScreen> createState() => _LogDeliveryScreenState();
}

class _LogDeliveryScreenState extends State<_LogDeliveryScreen> {
  List<Map<String, dynamic>> _warehouses = [];
  List<Map<String, dynamic>> _subcontractors = [];
  List<Map<String, dynamic>> _categories = [];
  String? _warehouseCode;
  int? _subcontractorId;
  final _refCtrl = TextEditingController();
  final List<_LineDraft> _lines = [_LineDraft()];
  bool _loading = true;
  bool _saving = false;
  // Reused across a manual retry after a timeout so the delivery can't be
  // logged twice — see server/middleware/idempotency.js.
  final String _idemKey = 'mobile-subc-delivery-${DateTime.now().microsecondsSinceEpoch}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final session = SessionScope.of(context);
    final meta = await session.api.get('/api/meta');
    final subs = await session.api.get('/api/subcontractor/subcontractors');
    final cats = await session.api.get('/api/subcontractor/categories');
    setState(() {
      _warehouses = List<Map<String, dynamic>>.from(meta['warehouses'] ?? []);
      _subcontractors = List<Map<String, dynamic>>.from(subs['subcontractors'] ?? []);
      _categories = List<Map<String, dynamic>>.from(cats['categories'] ?? []);
      _loading = false;
    });
  }

  Future<void> _submit() async {
    if (_warehouseCode == null || _subcontractorId == null) {
      showSnack(context, 'Choose a warehouse and subcontractor.', error: true);
      return;
    }
    final lines = _lines.where((l) => l.desc.text.trim().isNotEmpty).map((l) => {
          'description': l.desc.text.trim(),
          'quantity_delivered': double.tryParse(l.qty.text) ?? 0,
          'uom': l.uom.text.trim().isEmpty ? 'EA' : l.uom.text.trim(),
          'category_id': l.categoryId,
        }).toList();
    if (lines.isEmpty) {
      showSnack(context, 'Add at least one line with a description.', error: true);
      return;
    }
    setState(() => _saving = true);
    try {
      final session = SessionScope.of(context);
      await session.api.post('/api/subcontractor/deliveries', {
        'warehouse_code': _warehouseCode,
        'subcontractor_id': _subcontractorId,
        'delivery_note_ref': _refCtrl.text.trim(),
        'lines': lines,
        'idempotency_key': _idemKey,
      });
      if (mounted) {
        showSnack(context, 'Delivery logged and forwarded for quality inspection.');
        Navigator.pop(context, true);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Log Delivery')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Grouped by project — an optgroup-equivalent using a section-label pattern.
          DropdownButtonFormField<String>(
            initialValue: _warehouseCode,
            decoration: const InputDecoration(labelText: 'Warehouse *', border: OutlineInputBorder()),
            items: _warehouses.map((w) {
              final project = (w['project_name'] ?? '').toString();
              final label = '${w['warehouse_code']} — ${w['warehouse_name']}${project.isNotEmpty ? '  ($project)' : ''}';
              return DropdownMenuItem(value: w['warehouse_code'] as String, child: Text(label, overflow: TextOverflow.ellipsis));
            }).toList(),
            onChanged: (v) => setState(() => _warehouseCode = v),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<int>(
            initialValue: _subcontractorId,
            decoration: const InputDecoration(labelText: 'Subcontractor *', border: OutlineInputBorder()),
            items: _subcontractors.map((s) => DropdownMenuItem(value: s['id'] as int, child: Text(s['name'] as String))).toList(),
            onChanged: (v) => setState(() => _subcontractorId = v),
          ),
          const SizedBox(height: 12),
          TextField(controller: _refCtrl, decoration: const InputDecoration(labelText: 'Delivery Note Ref', border: OutlineInputBorder())),
          const SizedBox(height: 20),
          const Text('Lines', style: TextStyle(fontWeight: FontWeight.bold)),
          ..._lines.asMap().entries.map((entry) => _LineEditor(
                draft: entry.value,
                categories: _categories,
                onRemove: _lines.length > 1 ? () => setState(() => _lines.removeAt(entry.key)) : null,
              )),
          TextButton.icon(
            icon: const Icon(Icons.add),
            label: const Text('Add line'),
            onPressed: () => setState(() => _lines.add(_LineDraft())),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _saving ? null : _submit,
            child: _saving ? const CircularProgressIndicator() : const Text('Log Delivery'),
          ),
        ],
      ),
    );
  }
}

class _LineDraft {
  final desc = TextEditingController();
  final qty = TextEditingController();
  final uom = TextEditingController(text: 'EA');
  int? categoryId;
}

class _LineEditor extends StatefulWidget {
  const _LineEditor({required this.draft, required this.categories, this.onRemove});
  final _LineDraft draft;
  final List<Map<String, dynamic>> categories;
  final VoidCallback? onRemove;
  @override
  State<_LineEditor> createState() => _LineEditorState();
}

class _LineEditorState extends State<_LineEditor> {
  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(children: [
          Row(children: [
            Expanded(child: TextField(controller: widget.draft.desc, decoration: const InputDecoration(labelText: 'Description *'))),
            if (widget.onRemove != null) IconButton(icon: const Icon(Icons.close), onPressed: widget.onRemove),
          ]),
          Row(children: [
            Expanded(child: TextField(controller: widget.draft.qty, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Qty *'))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: widget.draft.uom, decoration: const InputDecoration(labelText: 'Unit'))),
          ]),
          DropdownButtonFormField<int>(
            initialValue: widget.draft.categoryId,
            decoration: const InputDecoration(labelText: 'Category'),
            items: widget.categories.map((c) => DropdownMenuItem(value: c['id'] as int, child: Text(c['name'] as String))).toList(),
            onChanged: (v) => setState(() => widget.draft.categoryId = v),
          ),
        ]),
      ),
    );
  }
}

class _DeliveryDetailScreen extends StatefulWidget {
  const _DeliveryDetailScreen({required this.deliveryId});
  final int deliveryId;
  @override
  State<_DeliveryDetailScreen> createState() => _DeliveryDetailScreenState();
}

class _DeliveryDetailScreenState extends State<_DeliveryDetailScreen> {
  int _key = 0;
  bool _busy = false;

  Future<void> _decide(int lineId, String status, double defaultQty) async {
    final qtyCtrl = TextEditingController(text: defaultQty.toString());
    final notesCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('$status — line decision'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          if (status != 'Rejected')
            TextField(controller: qtyCtrl, keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Quantity approved *')),
          TextField(controller: notesCtrl, maxLines: 2,
              decoration: InputDecoration(labelText: status == 'Approved' ? 'Notes (optional)' : 'Notes (required)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Confirm')),
        ],
      ),
    );
    if (confirmed != true) return;
    if (status != 'Approved' && notesCtrl.text.trim().isEmpty) {
      showSnack(context, 'A note is required for this decision.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final session = SessionScope.of(context);
      await session.api.patch('/api/subcontractor/deliveries/${widget.deliveryId}/lines/$lineId', {
        'quality_status': status,
        if (status != 'Rejected') 'quantity_approved': double.tryParse(qtyCtrl.text) ?? 0,
        'quality_notes': notesCtrl.text.trim().isEmpty ? null : notesCtrl.text.trim(),
      });
      if (mounted) {
        showSnack(context, status == 'Rejected' ? 'Line rejected.' : 'Line $status and recorded as stock.');
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
    final canDecide = session.can('subcontractor_quality_inspection');
    return Scaffold(
      appBar: AppBar(title: Text('Delivery DEL-${widget.deliveryId}')),
      body: Stack(children: [
        AsyncView<Map<String, dynamic>>(
          key: ValueKey(_key),
          load: () async => Map<String, dynamic>.from(
              await session.api.get('/api/subcontractor/deliveries/${widget.deliveryId}')),
          builder: (context, data, refresh) {
            final delivery = Map<String, dynamic>.from(data['delivery']);
            final lines = List<Map<String, dynamic>>.from(data['lines'] ?? []);
            return ListView(children: [
              Padding(
                padding: const EdgeInsets.all(14),
                child: Text('${delivery['warehouse_code']} · ${delivery['subcontractor_name']} · '
                    'delivered ${delivery['delivered_date']}', style: const TextStyle(color: Colors.grey)),
              ),
              ...lines.map((l) {
                final status = l['quality_status'] as String;
                final qty = (l['quantity_delivered'] as num).toDouble();
                return Card(
                  margin: const EdgeInsets.fromLTRB(12, 4, 12, 4),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(l['description'] as String, style: const TextStyle(fontWeight: FontWeight.bold))),
                        StatusChip(status),
                      ]),
                      Text('${fmtQty(qty)} ${l['uom']}${l['category_name'] != null ? ' · ${l['category_name']}' : ''}'
                          '${l['quantity_approved'] != null ? ' · ${fmtQty(l['quantity_approved'])} approved' : ''}',
                          style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      if ((l['quality_notes'] ?? '').toString().isNotEmpty)
                        Text('Note: ${l['quality_notes']}', style: const TextStyle(fontSize: 12)),
                      if (status == 'Pending' && canDecide) ...[
                        const SizedBox(height: 8),
                        Row(children: [
                          Expanded(child: FilledButton(
                              onPressed: _busy ? null : () => _decide(l['id'] as int, 'Approved', qty),
                              child: const Text('Approve'))),
                          const SizedBox(width: 6),
                          Expanded(child: OutlinedButton(
                              onPressed: _busy ? null : () => _decide(l['id'] as int, 'Approved with Remarks', qty),
                              child: const Text('Remarks'))),
                          const SizedBox(width: 6),
                          Expanded(child: OutlinedButton(
                              onPressed: _busy ? null : () => _decide(l['id'] as int, 'Rejected', 0),
                              child: const Text('Reject'))),
                        ]),
                      ],
                    ]),
                  ),
                );
              }),
            ]);
          },
        ),
        if (_busy) const Positioned.fill(child: ColoredBox(color: Color(0x33000000), child: Center(child: CircularProgressIndicator()))),
      ]),
    );
  }
}

// --- On-Hand Stock + Log Use --------------------------------------------------
class _StockTab extends StatefulWidget {
  const _StockTab();
  @override
  State<_StockTab> createState() => _StockTabState();
}

class _StockTabState extends State<_StockTab> {
  int _key = 0;

  Future<void> _logUse(Map<String, dynamic> row) async {
    final qtyCtrl = TextEditingController();
    final refCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Log use — ${row['description']}'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('${fmtQty(row['quantity_on_hand'])} ${row['uom']} on hand at ${row['warehouse_code']}',
              style: const TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 10),
          TextField(controller: qtyCtrl, keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Quantity used *')),
          TextField(controller: refCtrl, decoration: const InputDecoration(labelText: 'Reference')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Log Use')),
        ],
      ),
    );
    if (confirmed != true) return;
    final qty = double.tryParse(qtyCtrl.text) ?? 0;
    if (qty <= 0) {
      showSnack(context, 'Enter a quantity greater than zero.', error: true);
      return;
    }
    try {
      final session = SessionScope.of(context);
      // Deterministic (content-derived, not random) key: a manual retry after
      // a timeout re-opens this dialog with the same values, so the key must
      // match across that retry to be deduped — see
      // server/middleware/idempotency.js. A 5-minute time bucket is folded
      // in so a *legitimate* later re-use of the exact same values (a
      // different day, the same recurring reference) still gets its own key
      // instead of being silently swallowed by a stale cache entry.
      final bucket = DateTime.now().millisecondsSinceEpoch ~/ (5 * 60 * 1000);
      final idemKey = 'mobile-subc-consumption-${row['warehouse_code']}-${row['description']}-'
          '${row['category_id']}-${row['uom']}-$qty-${refCtrl.text.trim()}-$bucket';
      await session.api.post('/api/subcontractor/consumption', {
        'warehouse_code': row['warehouse_code'],
        'description': row['description'],
        'category_id': row['category_id'],
        'uom': row['uom'],
        'quantity_issued': qty,
        'reference': refCtrl.text.trim(),
        'idempotency_key': idemKey,
      });
      if (mounted) {
        showSnack(context, 'Consumption logged.');
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final canIssue = session.can('subcontractor_receiving');
    return AsyncView<List<Map<String, dynamic>>>(
      key: ValueKey(_key),
      load: () async {
        final res = await session.api.get('/api/subcontractor/stock');
        return List<Map<String, dynamic>>.from((res['stock'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      },
      builder: (context, rows, refresh) {
        if (rows.isEmpty) {
          return ListView(children: const [
            SizedBox(height: 80),
            Center(child: Text('No subcontractor stock on hand.', style: TextStyle(color: Colors.grey))),
          ]);
        }
        return ListView(
          children: rows.map((s) => Card(
                margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: ListTile(
                  title: Text(s['description'] as String, style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text('${s['warehouse_code']}${s['category_name'] != null ? ' · ${s['category_name']}' : ''}\n${s['subcontractors']}'),
                  isThreeLine: true,
                  trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text('${fmtQty(s['quantity_on_hand'])} ${s['uom']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    if (canIssue)
                      TextButton(onPressed: () => _logUse(s), child: const Text('Log Use')),
                  ]),
                ),
              )).toList(),
        );
      },
    );
  }
}

// --- Reconciliation (read-only) ---------------------------------------------
class _ReconciliationTab extends StatelessWidget {
  const _ReconciliationTab();
  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<List<Map<String, dynamic>>>(
      load: () async {
        final res = await session.api.get('/api/subcontractor/reconciliation');
        return List<Map<String, dynamic>>.from((res['reconciliation'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      },
      builder: (context, rows, refresh) {
        if (rows.isEmpty) {
          return ListView(children: const [
            SizedBox(height: 80),
            Center(child: Text('Nothing to reconcile yet.', style: TextStyle(color: Colors.grey))),
          ]);
        }
        return ListView(
          children: rows.map((r) => Card(
                margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(r['description'] as String, style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text('${r['warehouse_code']}${r['category_name'] != null ? ' · ${r['category_name']}' : ''}',
                        style: const TextStyle(fontSize: 12, color: Colors.grey)),
                    const SizedBox(height: 8),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      _ReconStat('Received', r['quantity_received'], r['uom']),
                      _ReconStat('Consumed', r['quantity_consumed'], r['uom']),
                      _ReconStat('Remaining', r['quantity_on_hand'], r['uom'], emphasize: true),
                    ]),
                  ]),
                ),
              )).toList(),
        );
      },
    );
  }
}

class _ReconStat extends StatelessWidget {
  const _ReconStat(this.label, this.value, this.uom, {this.emphasize = false});
  final String label;
  final dynamic value;
  final dynamic uom;
  final bool emphasize;
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Text(label.toUpperCase(), style: const TextStyle(fontSize: 10, color: Colors.grey, letterSpacing: 0.5)),
      Text('${fmtQty(value)} $uom',
          style: TextStyle(fontWeight: FontWeight.bold, color: (value == 0 && emphasize) ? Colors.grey : null)),
    ]);
  }
}
