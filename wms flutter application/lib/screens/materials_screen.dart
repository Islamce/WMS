import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Materials — searchable read-only master data list with live batch stock.
/// Mirrors GET /api/materials (paginated; first page shown, searchable).
class MaterialsScreen extends StatefulWidget {
  const MaterialsScreen({super.key});
  @override
  State<MaterialsScreen> createState() => _MaterialsScreenState();
}

class _MaterialsScreenState extends State<MaterialsScreen> {
  String _search = '';
  final _ctrl = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(10),
          child: TextField(
            controller: _ctrl,
            decoration: InputDecoration(
              hintText: 'Search code / description / group',
              prefixIcon: const Icon(Icons.search),
              border: const OutlineInputBorder(),
              isDense: true,
              suffixIcon: _search.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () { _ctrl.clear(); setState(() => _search = ''); }),
            ),
            onSubmitted: (v) => setState(() => _search = v.trim()),
          ),
        ),
        Expanded(
          child: AsyncView<List<Map<String, dynamic>>>(
            key: ValueKey(_search),
            load: () async {
              final res = await session.api.get(
                  '/api/materials?limit=50&search=${Uri.encodeQueryComponent(_search)}');
              return List<Map<String, dynamic>>.from(
                  (res['materials'] ?? []).map((e) => Map<String, dynamic>.from(e)));
            },
            builder: (context, rows, refresh) {
              if (rows.isEmpty) {
                return ListView(children: const [
                  SizedBox(height: 80),
                  Center(child: Text('No materials.', style: TextStyle(color: Colors.grey))),
                ]);
              }
              return ListView.separated(
                itemCount: rows.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final m = rows[i];
                  final stock = m['available_stock'] ?? m['total_stock'];
                  final canSeeLocations = session.can('batch_tracking') ||
                      session.can('bin_batch_assignment') || session.can('quality');
                  return ListTile(
                    title: Text('${m['item_code']} · ${m['description'] ?? ''}',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                        maxLines: 2, overflow: TextOverflow.ellipsis),
                    subtitle: Text([
                      if ((m['material_group'] ?? '').toString().isNotEmpty) 'Group ${m['material_group']}',
                      if ((m['material_type'] ?? '').toString().isNotEmpty) '${m['material_type']}',
                      if ((m['plant'] ?? '').toString().isNotEmpty) 'Plant ${m['plant']}',
                    ].join(' · ')),
                    trailing: stock == null
                        ? null
                        : Text('${fmtQty(stock)}\n${m['unit'] ?? ''}',
                            textAlign: TextAlign.right,
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    onTap: canSeeLocations
                        ? () => _showLocations(context, session, m)
                        : null,
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _showLocations(BuildContext context, dynamic session, Map<String, dynamic> m) async {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${m['item_code']} — locations'),
        content: SizedBox(
          width: 360,
          child: FutureBuilder<Map<String, dynamic>>(
            future: session.api.get(
                '/api/master/batches?search=${Uri.encodeQueryComponent(m['item_code'] ?? '')}&limit=100')
                .then((r) => Map<String, dynamic>.from(r)),
            builder: (context, snap) {
              if (!snap.hasData) {
                return const SizedBox(height: 80, child: Center(child: CircularProgressIndicator()));
              }
              final batches = List<Map<String, dynamic>>.from(
                  (snap.data!['batches'] ?? []).map((e) => Map<String, dynamic>.from(e)))
                .where((b) => (b['remaining_quantity'] ?? 0) > 0)
                .toList();
              if (batches.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Text('No stock currently held in any bin.', style: TextStyle(color: Colors.grey)),
                );
              }
              return SizedBox(
                height: 300,
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: batches.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final b = batches[i];
                    return ListTile(
                      dense: true,
                      title: Text('${b['bin_location'] ?? '—'} · ${b['warehouse_code'] ?? ''}'),
                      subtitle: Text('Batch ${b['batch_number'] ?? '—'}'),
                      trailing: Text(fmtQty(b['remaining_quantity']),
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                    );
                  },
                ),
              );
            },
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
      ),
    );
  }
}
