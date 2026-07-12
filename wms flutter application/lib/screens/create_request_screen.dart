import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

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
  String _priority = 'NORMAL';
  final _purpose = TextEditingController();
  final List<_Line> _lines = [];
  bool _busy = false;
  bool _loadingMeta = true;

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
    final picked = await showSearch<Map<String, dynamic>?>(
      context: context,
      delegate: _MaterialSearchDelegate(SessionScope.of(context)),
    );
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
    try {
      final body = {
        'department': _department,
        'plant': _plant,
        'priority': _priority,
        'purpose': _purpose.text.trim(),
        'lines': _lines.map((l) => {
              'material_id': l.materialId,
              'requested_quantity': l.qty,
            }).toList(),
      };
      final res = await SessionScope.of(context).api.post('/api/requests', body);
      final id = res['id'];
      // Auto-submit so it lands in the approval queue immediately.
      await SessionScope.of(context).api.post('/api/requests/$id/submit');
      if (mounted) {
        showSnack(context, 'Request ${res['request_number'] ?? ''} created and submitted.');
        setState(() {
          _lines.clear();
          _purpose.clear();
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
                icon: const Icon(Icons.add_circle, color: Color(0xFF2a78d6)),
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

/// Material search with live results from /api/materials/search.
class _MaterialSearchDelegate extends SearchDelegate<Map<String, dynamic>?> {
  _MaterialSearchDelegate(this.session);
  final dynamic session;

  @override
  String get searchFieldLabel => 'Search material code or name';

  @override
  List<Widget> buildActions(BuildContext context) =>
      [IconButton(icon: const Icon(Icons.clear), onPressed: () => query = '')];

  @override
  Widget buildLeading(BuildContext context) =>
      IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => close(context, null));

  @override
  Widget buildResults(BuildContext context) => _results();

  @override
  Widget buildSuggestions(BuildContext context) => _results();

  Widget _results() {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: () async {
        final res = await session.api.get('/api/materials/search?q=${Uri.encodeQueryComponent(query)}');
        return List<Map<String, dynamic>>.from(
            (res['materials'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      }(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return Center(child: Text('${snap.error}', style: const TextStyle(color: Colors.grey)));
        }
        final items = snap.data ?? [];
        if (items.isEmpty) {
          return const Center(child: Text('No materials found.', style: TextStyle(color: Colors.grey)));
        }
        return ListView.separated(
          itemCount: items.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final m = items[i];
            return ListTile(
              title: Text('${m['item_code']} · ${m['description'] ?? ''}'),
              subtitle: Text('Available: ${fmtQty(m['total_available'])} ${m['unit'] ?? ''}'),
              onTap: () => close(context, m),
            );
          },
        );
      },
    );
  }
}
