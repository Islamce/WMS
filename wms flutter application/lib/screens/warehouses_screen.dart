import 'package:flutter/material.dart';

import '../main.dart';
import '../widgets/common.dart';

/// Warehouses / Site Stores — read-only master data list, grouped by project
/// (site/project stores are meaningless without knowing which project they
/// belong to). Mirrors the web app's Warehouses Master screen.
/// GET /api/master/warehouses (+ /api/master/warehouses/projects for the filter).
class WarehousesScreen extends StatefulWidget {
  const WarehousesScreen({super.key});
  @override
  State<WarehousesScreen> createState() => _WarehousesScreenState();
}

class _WarehousesScreenState extends State<WarehousesScreen> {
  String _project = '';

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Column(
      children: [
        FutureBuilder<Map<String, dynamic>>(
          future: session.api.get('/api/master/warehouses/projects')
              .then((r) => Map<String, dynamic>.from(r)),
          builder: (context, snap) {
            final projects = List<String>.from(snap.data?['projects'] ?? const []);
            if (projects.isEmpty) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.fromLTRB(10, 10, 10, 0),
              child: SizedBox(
                height: 36,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ChoiceChip(
                        label: const Text('All'),
                        selected: _project.isEmpty,
                        onSelected: (_) => setState(() => _project = ''),
                      ),
                    ),
                    ...projects.map((p) => Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
                            label: Text(p),
                            selected: _project == p,
                            onSelected: (_) => setState(() => _project = p),
                          ),
                        )),
                  ],
                ),
              ),
            );
          },
        ),
        Expanded(
          child: AsyncView<List<Map<String, dynamic>>>(
            key: ValueKey(_project),
            load: () async {
              final q = _project.isEmpty ? '' : '?project_name=${Uri.encodeQueryComponent(_project)}';
              final res = await session.api.get('/api/master/warehouses$q');
              return List<Map<String, dynamic>>.from(
                  (res['warehouses'] ?? []).map((e) => Map<String, dynamic>.from(e)));
            },
            builder: (context, rows, refresh) {
              if (rows.isEmpty) {
                return ListView(children: const [
                  SizedBox(height: 80),
                  Center(child: Text('No warehouses found.', style: TextStyle(color: Colors.grey))),
                ]);
              }
              final groups = <String, List<Map<String, dynamic>>>{};
              for (final w in rows) {
                final key = (w['project_name'] ?? '').toString().trim().isEmpty
                    ? '— No project —'
                    : w['project_name'].toString();
                (groups[key] ??= []).add(w);
              }
              final keys = groups.keys.toList()..sort();
              return RefreshIndicator(
                onRefresh: () async => refresh(),
                child: ListView(
                  padding: const EdgeInsets.all(10),
                  children: keys.expand((k) sync* {
                    yield Padding(
                      padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
                      child: Text(k, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    );
                    for (final w in groups[k]!) {
                      yield Card(
                        margin: const EdgeInsets.symmetric(vertical: 3),
                        child: ListTile(
                          leading: const Icon(Icons.warehouse_outlined),
                          title: Text('${w['warehouse_code']} · ${w['warehouse_name'] ?? ''}',
                              style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text([
                            if ((w['warehouse_type'] ?? '').toString().isNotEmpty) '${w['warehouse_type']}',
                            if ((w['plant'] ?? '').toString().isNotEmpty) 'Plant ${w['plant']}',
                            if ((w['storage_location'] ?? '').toString().isNotEmpty) 'SLoc ${w['storage_location']}',
                          ].join(' · ')),
                        ),
                      );
                    }
                  }).toList(),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
