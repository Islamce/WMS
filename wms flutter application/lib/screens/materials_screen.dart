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
                  final stock = m['total_available'] ?? m['current_stock'];
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
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}
