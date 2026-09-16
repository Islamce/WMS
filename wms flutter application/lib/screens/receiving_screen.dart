import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../main.dart';
import '../widgets/common.dart';
import '../widgets/material_search.dart';

/// Goods Receipt — receive a material into a warehouse. PO number is mandatory;
/// the backend auto-generates the batch number and forces QUALITY_HOLD until a
/// quality check releases it. Mirrors POST /api/receiving.
class ReceivingScreen extends StatefulWidget {
  const ReceivingScreen({super.key});
  @override
  State<ReceivingScreen> createState() => _ReceivingScreenState();
}

class _ReceivingScreenState extends State<ReceivingScreen> {
  Map<String, dynamic>? _material;
  final _qty = TextEditingController();
  final _po = TextEditingController();
  final _mfg = TextEditingController();
  final _expiry = TextEditingController();
  String? _warehouse;
  List<Map<String, dynamic>> _warehouses = [];
  // Ownership is decided at receipt and cannot be changed afterwards (the
  // server deliberately has no endpoint for it). This screen used to send no
  // owner at all, so a subcontractor's delivery booked on a phone became
  // company stock - permanently.
  String _owner = 'COMPANY';
  int? _subcontractorId;
  List<Map<String, dynamic>> _subcontractors = [];
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadMeta());
  }

  Future<void> _loadMeta() async {
    try {
      final api = SessionScope.of(context).api;
      final meta = Map<String, dynamic>.from(await api.get('/api/meta'));
      // Only a contracting tenant has a subcontractor register; elsewhere the
      // module is absent and this call fails, which simply hides the question.
      List<Map<String, dynamic>> subs = [];
      try {
        final r = Map<String, dynamic>.from(await api.get('/api/subcontractor/subcontractors'));
        subs = List<Map<String, dynamic>>.from(
            (r['subcontractors'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      } catch (_) {
        subs = [];
      }
      setState(() {
        _warehouses = List<Map<String, dynamic>>.from(
            (meta['warehouses'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        _subcontractors = subs;
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) showSnack(context, '$e', error: true);
    }
  }

  Future<void> _pickDate(TextEditingController ctrl) async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 15),
    );
    if (d != null) {
      ctrl.text = '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    }
  }

  Future<void> _receive() async {
    if (_material == null) { showSnack(context, 'Select a material.', error: true); return; }
    final qty = double.tryParse(_qty.text.trim());
    if (qty == null || qty <= 0) { showSnack(context, 'Enter a valid quantity.', error: true); return; }
    if (_warehouse == null) { showSnack(context, 'Select a warehouse.', error: true); return; }
    final subOwned = _owner == 'SUBCONTRACTOR';
    if (_po.text.trim().isEmpty) {
      showSnack(context, subOwned ? 'Delivery note is mandatory.' : 'PO number is mandatory.', error: true);
      return;
    }
    if (subOwned && _subcontractorId == null) { showSnack(context, 'Select the subcontractor.', error: true); return; }

    final session = SessionScope.of(context);
    // A stable idempotency_key travels with this receipt from the first
    // attempt through any offline-queued replay, so a network drop after the
    // server already created the batch can never create a second one when
    // the same request is resent — see server/middleware/idempotency.js.
    final path = '/api/receiving';
    final body = <String, dynamic>{
      'material_id': _material!['id'],
      'received_quantity': qty,
      'warehouse_code': _warehouse,
      'po_number': _po.text.trim(),
      'owner_type': _owner,
      if (subOwned) 'owner_subcontractor_id': _subcontractorId,
      if (_mfg.text.trim().isNotEmpty) 'manufacturing_date': _mfg.text.trim(),
      if (_expiry.text.trim().isNotEmpty) 'expiry_date': _expiry.text.trim(),
      'idempotency_key': 'mobile-gr-${DateTime.now().microsecondsSinceEpoch}',
    };
    final description = 'Goods receipt — ${_material!['item_code']} × $qty';

    void resetForm() => setState(() {
          _material = null;
          _owner = 'COMPANY';
          _subcontractorId = null;
          _qty.clear(); _po.clear(); _mfg.clear(); _expiry.clear();
        });

    if (!session.online) {
      await session.enqueueOffline(method: 'POST', path: path, body: body, description: description);
      if (mounted) {
        showSnack(context, 'Offline — receipt saved, will sync when connected.');
        resetForm();
      }
      return;
    }

    setState(() => _busy = true);
    try {
      final res = await session.api.post(path, body);
      if (mounted) {
        showSnack(context, '${res['message'] ?? 'Received.'}');
        resetForm();
      }
    } on ApiException catch (e) {
      if (e.statusCode == 0) {
        await session.enqueueOffline(method: 'POST', path: path, body: body, description: description);
        if (mounted) {
          showSnack(context, 'Offline — receipt saved, will sync when connected.');
          resetForm();
        }
      } else if (mounted) {
        showSnack(context, e.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return Stack(children: [
      ListView(
        children: [
          SectionCard(
            title: 'Receive goods',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                OutlinedButton.icon(
                  icon: const Icon(Icons.search),
                  label: Text(_material == null
                      ? 'Select material'
                      : '${_material!['item_code']} · ${_material!['description'] ?? ''}'),
                  onPressed: () async {
                    final m = await pickMaterial(context, SessionScope.of(context));
                    if (m != null) setState(() => _material = m);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _qty,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Received quantity', border: OutlineInputBorder()),
                ),
                if (_subcontractors.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _owner,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Whose material is this?', border: OutlineInputBorder()),
                    items: const [
                      DropdownMenuItem(value: 'COMPANY', child: Text("The company's own stock")),
                      DropdownMenuItem(value: 'SUBCONTRACTOR', child: Text("A subcontractor's material (we only hold it)")),
                    ],
                    onChanged: (v) => setState(() { _owner = v ?? 'COMPANY'; if (_owner == 'COMPANY') _subcontractorId = null; }),
                  ),
                  if (_owner == 'SUBCONTRACTOR') ...[
                    const SizedBox(height: 12),
                    DropdownButtonFormField<int>(
                      initialValue: _subcontractorId,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Subcontractor',
                        helperText: 'Ownership is set here and cannot be changed later.',
                        border: OutlineInputBorder(),
                      ),
                      items: _subcontractors
                          .map((s) => DropdownMenuItem<int>(
                              value: (s['id'] as num).toInt(),
                              child: Text('${s['name'] ?? ''}', overflow: TextOverflow.ellipsis)))
                          .toList(),
                      onChanged: (v) => setState(() => _subcontractorId = v),
                    ),
                  ],
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _po,
                  decoration: InputDecoration(
                    // A purchase order proves the company bought it. For a
                    // subcontractor's material there is none - ask for the
                    // delivery note instead of making the storekeeper invent one.
                    labelText: _owner == 'SUBCONTRACTOR' ? 'Delivery note (mandatory)' : 'PO number (mandatory)',
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _warehouse,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Warehouse', border: OutlineInputBorder()),
                  items: _warehouses
                      .map((w) => DropdownMenuItem(
                          value: '${w['warehouse_code']}',
                          child: Text('${w['warehouse_code']} · ${w['warehouse_name'] ?? ''}',
                              overflow: TextOverflow.ellipsis)))
                      .toList(),
                  onChanged: (v) => setState(() => _warehouse = v),
                ),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: _mfg,
                      readOnly: true,
                      onTap: () => _pickDate(_mfg),
                      decoration: const InputDecoration(
                          labelText: 'Mfg date (optional)', border: OutlineInputBorder(),
                          suffixIcon: Icon(Icons.calendar_today, size: 18)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _expiry,
                      readOnly: true,
                      onTap: () => _pickDate(_expiry),
                      decoration: const InputDecoration(
                          labelText: 'Expiry (optional)', border: OutlineInputBorder(),
                          suffixIcon: Icon(Icons.calendar_today, size: 18)),
                    ),
                  ),
                ]),
                const SizedBox(height: 8),
                const Text('The batch number is generated automatically and the batch lands on '
                    'Quality Hold until a quality check releases it.',
                    style: TextStyle(fontSize: 11, color: Colors.grey)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: FilledButton.icon(
              icon: const Icon(Icons.download_done),
              label: const Text('Receive'),
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              onPressed: _busy ? null : _receive,
            ),
          ),
        ],
      ),
      if (_busy)
        const Positioned.fill(
          child: ColoredBox(color: Color(0x33000000), child: Center(child: CircularProgressIndicator())),
        ),
    ]);
  }
}
