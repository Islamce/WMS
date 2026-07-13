import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Batch Tracking — searchable list of batches with quantities, quality status
/// and expiry alert level. Read-only. Mirrors GET /api/master/batches.
class BatchesScreen extends StatefulWidget {
  const BatchesScreen({super.key});
  @override
  State<BatchesScreen> createState() => _BatchesScreenState();
}

class _BatchesScreenState extends State<BatchesScreen> {
  String _search = '';
  final _ctrl = TextEditingController();

  Color _alertColor(String? level) {
    switch (level) {
      case 'EXPIRED':
      case 'CRITICAL':
        return const Color(0xFFe34948);
      case 'NEAR_EXPIRY':
      case 'EARLY_WARNING':
        return const Color(0xFFeda100);
      default:
        return const Color(0xFF1baf7a);
    }
  }

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
              hintText: 'Search batch / material / warehouse',
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
              final res = await session.api
                  .get('/api/master/batches?search=${Uri.encodeQueryComponent(_search)}');
              return List<Map<String, dynamic>>.from(
                  (res['batches'] ?? []).map((e) => Map<String, dynamic>.from(e)));
            },
            builder: (context, rows, refresh) {
              if (rows.isEmpty) {
                return ListView(children: const [
                  SizedBox(height: 80),
                  Center(child: Text('No batches.', style: TextStyle(color: Colors.grey))),
                ]);
              }
              return ListView.separated(
                itemCount: rows.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final b = rows[i];
                  final avail = b['available_quantity'] ?? b['remaining_quantity'];
                  return ListTile(
                    title: Text('${b['batch_number']} · ${b['material_code']}',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${b['material_description'] ?? ''}',
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        Text('WH ${b['warehouse_code'] ?? ''} · '
                            'avail ${fmtQty(avail)} / ${fmtQty(b['remaining_quantity'])}'
                            '${(b['expiry_date'] ?? '').toString().isNotEmpty ? ' · exp ${b['expiry_date']}' : ''}',
                            style: const TextStyle(fontSize: 12)),
                      ],
                    ),
                    isThreeLine: true,
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        StatusChip('${b['quality_status']}'),
                        if ((b['alert_level'] ?? 'OK') != 'OK')
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text('${b['alert_level']}',
                                style: TextStyle(fontSize: 10, color: _alertColor('${b['alert_level']}'))),
                          ),
                      ],
                    ),
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
