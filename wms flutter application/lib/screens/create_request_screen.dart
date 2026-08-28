import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';
import '../widgets/material_search.dart';

class _Line {
  _Line(this.materialId, this.label, this.qty, this.available);
  final int materialId;
  final String label;
  double qty;
  final num available;
}

class CreateRequestScreen extends StatefulWidget {
  const CreateRequestScreen({super.key});
  @override
  State<CreateRequestScreen> createState() => _CreateRequestScreenState();
}

class _CreateRequestScreenState extends State<CreateRequestScreen> {
  Map<String, dynamic>? _meta;
  String? _department;
  String? _plant;
  String? _costCenter;
  String _priority = 'NORMAL';
  DateTime? _requiredDate;
  final _purpose = TextEditingController();
  final _wbs = TextEditingController();
  final List<_Line> _lines = [];
  bool _busy = false;
  bool _loadingMeta = true;
  // Generated once per logical submission attempt and reused across a
  // manual retry after a timeout, so a request that actually landed on the
  // server but whose response was lost can't be created a second time by
  // re-tapping Submit — see server/middleware/idempotency.js.
  String? _idemKey;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadMeta());
  }

  Future<void> _loadMeta() async {
    try {
      final m = Map<String, dynamic>.from(await SessionScope.of(context).api.get('/api/meta'));
      setState(() { _meta = m; _loadingMeta = false; });
    } catch (e) {
      setState(() => _loadingMeta = false);
      if (mounted) showSnack(context, '$e', error: true);
    }
  }

  List<Map<String, dynamic>> _ref(String key) =>
      List<Map<String, dynamic>>.from((_meta?[key] ?? []).map((e) => Map<String, dynamic>.from(e)));

  Future<void> _addLine() async {
    final picked = await pickMaterial(context, SessionScope.of(context));
    if (picked == null) return;
    final qty = await _askQuantity(picked);
    if (qty == null) return;
    setState(() => _lines.add(_Line(
        picked['id'] as int,
        '${picked['item_code']} · ${picked['description'] ?? ''}',
        qty,
        (picked['total_available'] ?? 0) as num)));
  }

  Future<double?> _askQuantity(Map<String, dynamic> material) {
    final ctrl = TextEditingController(text: '1');
    return showDialog<double>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${material['item_code']}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${material['description'] ?? ''}'),
            const SizedBox(height: 4),
            Text('Available: ${fmtQty(material['total_available'])} ${material['unit'] ?? ''}',
                style: const TextStyle(fontSize: 12, color: Colors.grey)),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Quantity', border: OutlineInputBorder()),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final q = double.tryParse(ctrl.text.trim());
              if (q == null || q <= 0) return;
              Navigator.pop(context, q);
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    if (_lines.isEmpty) {
      showSnack(context, 'Add at least one material line.', error: true);
      return;
    }
    setState(() => _busy = true);
    _idemKey ??= 'mobile-req-${DateTime.now().microsecondsSinceEpoch}';
    try {
      final body = {
        'department': _department,
        'plant': _plant,
        'cost_center': _costCenter,
        'wbs_element': _wbs.text.trim(),
        'priority': _priority,
        'required_date': _requiredDate == null
            ? null
            : '${_requiredDate!.year.toString().padLeft(4, '0')}-'
                '${_requiredDate!.month.toString().padLeft(2, '0')}-'
                '${_requiredDate!.day.toString().padLeft(2, '0')}',
        'purpose': _purpose.text.trim(),
        'lines': _lines.map((l) => {
              'material_id': l.materialId,
              'requested_quantity': l.qty,
            }).toList(),
        'idempotency_key': _idemKey,
      };
      final res = await SessionScope.of(context).api.post('/api/requests', body);
      final id = res['id'];
      // Auto-submit so it lands in the approval queue immediately.
      // (idempotent server-side by request status, so no key needed here.)
      await SessionScope.of(context).api.post('/api/requests/$id/submit');
      if (mounted) {
        showSnack(context, 'Request ${res['request_number'] ?? ''} created and submitted.');
        setState(() {
          _lines.clear();
          _purpose.clear();
          _wbs.clear();
          _costCenter = null;
          _requiredDate = null;
          _idemKey = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingMeta) {
      return const Center(child: CircularProgressIndicator());
    }
    final departments = _ref('departments');
    final plants = _ref('plants');
    final costCenters = _ref('costCenters');
    return Stack(
      children: [
        ListView(
          children: [
            SectionCard(
              title: 'Request header',
              child: Column(
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: _department,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Department', border: OutlineInputBorder()),
                    items: departments
                        .map((d) => DropdownMenuItem(
                            value: d['code'].toString(), child: Text('${d['label']}')))
                        .toList(),
                    onChanged: (v) => setState(() => _department = v),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _plant,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Plant', border: OutlineInputBorder()),
                    items: plants
                        .map((d) => DropdownMenuItem(
                            value: d['code'].toString(), child: Text('${d['code']} · ${d['label']}')))
                        .toList(),
                    onChanged: (v) => setState(() => _plant = v),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _priority,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Priority', border: OutlineInputBorder()),
                    items: const ['LOW', 'NORMAL', 'HIGH', 'URGENT']
                        .map((p) => DropdownMenuItem(value: p, child: Text(p)))
                        .toList(),
                    onChanged: (v) => setState(() => _priority = v ?? 'NORMAL'),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _costCenter,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Cost Center', border: OutlineInputBorder()),
                    items: costCenters
                        .map((c) => DropdownMenuItem(
                            value: c['code'].toString(), child: Text('${c['code']} · ${c['label']}')))
                        .toList(),
                    onChanged: (v) => setState(() => _costCenter = v),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _wbs,
                    decoration: const InputDecoration(
                        labelText: 'Project / WBS Element', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),
                  InkWell(
                    onTap: () async {
                      final now = DateTime.now();
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _requiredDate ?? now,
                        firstDate: now.subtract(const Duration(days: 1)),
                        lastDate: now.add(const Duration(days: 730)),
                      );
                      if (picked != null) setState(() => _requiredDate = picked);
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(
                          labelText: 'Required Date', border: OutlineInputBorder(),
                          suffixIcon: Icon(Icons.calendar_today_outlined)),
                      child: Text(_requiredDate == null
                          ? 'Select a date'
                          : '${_requiredDate!.year.toString().padLeft(4, '0')}-'
                              '${_requiredDate!.month.toString().padLeft(2, '0')}-'
                              '${_requiredDate!.day.toString().padLeft(2, '0')}'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _purpose,
                    maxLines: 2,
                    decoration: const InputDecoration(
                        labelText: 'Purpose (optional)', border: OutlineInputBorder()),
                  ),
                ],
              ),
            ),
            SectionCard(
              title: 'Material lines (${_lines.length})',
              trailing: IconButton(
                icon: const Icon(Icons.add_circle, color: Color(0xFF31c3c9)),
                onPressed: _addLine,
              ),
              child: _lines.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Text('No lines yet. Tap + to add a material.',
                          style: TextStyle(color: Colors.grey)))
                  : Column(
                      children: _lines.asMap().entries.map((e) {
                        final l = e.value;
                        final short = l.qty > l.available;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(l.label, maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text(
                            'Qty ${fmtQty(l.qty)} · available ${fmtQty(l.available)}'
                            '${short ? ' — not enough stock' : ''}',
                            style: TextStyle(
                                fontSize: 12,
                                color: short ? const Color(0xFFe34948) : Colors.grey),
                          ),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => setState(() => _lines.removeAt(e.key)),
                          ),
                        );
                      }).toList(),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: FilledButton.icon(
                icon: const Icon(Icons.send),
                label: const Text('Create & submit request'),
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                onPressed: _busy ? null : _submit,
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
        if (_busy)
          const Positioned.fill(
            child: ColoredBox(
              color: Color(0x66000000),
              child: Center(child: CircularProgressIndicator()),
            ),
          ),
      ],
    );
  }
}
