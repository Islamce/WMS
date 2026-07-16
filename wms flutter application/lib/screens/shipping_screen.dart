import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Shipping & Outbound — delivery orders from GI-posted requests:
/// pack → load → dispatch → deliver (with proof of delivery).
class ShippingScreen extends StatefulWidget {
  const ShippingScreen({super.key});
  @override
  State<ShippingScreen> createState() => _ShippingScreenState();
}

class _ShippingScreenState extends State<ShippingScreen> {
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

  (String, String)? _next(String status) => switch (status) {
        'OPEN' => ('pack', 'Pack'),
        'PACKED' => ('load', 'Load'),
        'LOADED' => ('dispatch', 'Dispatch'),
        _ => null,
      };

  Future<void> _deliver(int id) async {
    final name = TextEditingController();
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t('Confirm delivery (POD)')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, autofocus: true,
              decoration: InputDecoration(labelText: t('Received by'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: note,
              decoration: InputDecoration(labelText: t('POD note'), border: const OutlineInputBorder())),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t('Cancel'))),
          FilledButton(
            onPressed: () {
              if (name.text.trim().isEmpty) return;
              Navigator.pop(context, true);
            },
            child: Text(t('Confirm delivery')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() async {
      final api = SessionScope.of(context).api;
      final r = await api.post('/api/shipping/$id/deliver',
          {'delivered_to': name.text.trim(), 'pod_note': note.text.trim()});
      if (mounted) showSnack(context, '${r['message']}');
    });
  }

  Future<void> _create() async {
    final api = SessionScope.of(context).api;
    List<Map<String, dynamic>> eligible = [];
    try {
      final res = await api.get('/api/shipping/eligible');
      eligible = List<Map<String, dynamic>>.from(
          (res['requests'] ?? []).map((e) => Map<String, dynamic>.from(e)));
    } catch (_) {}
    if (!mounted) return;

    int? requestId;
    final shipTo = TextEditingController();
    final carrier = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t('New delivery order')),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<int>(
              isExpanded: true,
              decoration: InputDecoration(labelText: t('Source request (GI posted)'), border: const OutlineInputBorder()),
              items: [
                DropdownMenuItem(value: null, child: Text(t('No linked request'))),
                ...eligible.map((r) => DropdownMenuItem(
                    value: r['id'] as int,
                    child: Text('${r['request_number']} · ${r['requester_name'] ?? ''}',
                        overflow: TextOverflow.ellipsis))),
              ],
              onChanged: (v) => requestId = v,
            ),
            const SizedBox(height: 10),
            TextField(controller: shipTo,
                decoration: InputDecoration(labelText: '${t('Ship to')} *', border: const OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(controller: carrier,
                decoration: InputDecoration(labelText: t('Carrier'), border: const OutlineInputBorder())),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t('Cancel'))),
          FilledButton(
            onPressed: () {
              if (shipTo.text.trim().isEmpty) return;
              Navigator.pop(context, true);
            },
            child: Text(t('Create shipment')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() async {
      final r = await api.post('/api/shipping', {
        'request_id': requestId,
        'ship_to': shipTo.text.trim(),
        'carrier': carrier.text.trim(),
      });
      if (mounted) showSnack(context, '${r['message']}');
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busy ? null : _create,
        icon: const Icon(Icons.add),
        label: Text(t('Delivery order')),
      ),
      body: Stack(children: [
        AsyncView<List<Map<String, dynamic>>>(
          key: ValueKey(_key),
          load: () async {
            final res = await session.api.get('/api/shipping');
            return List<Map<String, dynamic>>.from(
                (res['shipments'] ?? []).map((e) => Map<String, dynamic>.from(e)));
          },
          builder: (context, rows, refresh) {
            if (rows.isEmpty) {
              return ListView(children: [
                const SizedBox(height: 80),
                Center(child: Text(t('No shipments yet'), style: const TextStyle(color: Colors.grey))),
              ]);
            }
            return ListView(
              children: rows.map((s) {
                final id = s['id'] as int;
                final status = '${s['status']}';
                final next = _next(status);
                return Card(
                  margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          Expanded(child: Text('${s['shipment_number']}',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
                          StatusChip(status),
                        ]),
                        const SizedBox(height: 4),
                        Text('${s['ship_to'] ?? ''}'
                            '${(s['request_number'] ?? '').toString().isNotEmpty ? ' · ${s['request_number']}' : ''}'
                            '${(s['carrier'] ?? '').toString().isNotEmpty ? ' · ${s['carrier']}' : ''}'),
                        Text(fmtDate(s['created_at']),
                            style: const TextStyle(fontSize: 12, color: Colors.grey)),
                        if (status == 'DELIVERED' && (s['delivered_to'] ?? '').toString().isNotEmpty)
                          Text('POD: ${s['delivered_to']}',
                              style: const TextStyle(fontSize: 12, color: Color(0xFF1baf7a))),
                        const SizedBox(height: 8),
                        Wrap(spacing: 8, children: [
                          if (next != null)
                            FilledButton(
                              onPressed: _busy ? null : () => _run(() async {
                                final api = SessionScope.of(context).api;
                                final r = await api.post('/api/shipping/$id/${next.$1}');
                                if (mounted) showSnack(context, '${r['message']}');
                              }),
                              child: Text(t(next.$2)),
                            ),
                          if (status == 'DISPATCHED')
                            FilledButton(
                              onPressed: _busy ? null : () => _deliver(id),
                              child: Text(t('Deliver')),
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
      ]),
    );
  }
}
