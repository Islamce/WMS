import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Stock movement history — the actual rows behind the Dashboard's
/// "Stock In/Out (today)" tiles and "Recent movements" list. Mirrors
/// GET /api/stock/transactions (?type=IN|OUT, ?today=1, ?search=).
///
/// Read-only and searchable, matching the pattern of Batch Tracking /
/// Materials — this screen didn't exist before, which is why those
/// dashboard entries used to fall back to unrelated screens.
class StockMovementsScreen extends StatefulWidget {
  const StockMovementsScreen({super.key, this.type, this.today = false});

  /// 'IN' | 'OUT' | null (both).
  final String? type;
  final bool today;

  @override
  State<StockMovementsScreen> createState() => _StockMovementsScreenState();
}

class _StockMovementsScreenState extends State<StockMovementsScreen> {
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
              hintText: 'Search material / location / reservation / user',
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
              final params = <String, String>{
                'limit': '100',
                if (_search.isNotEmpty) 'search': _search,
                if (widget.type != null) 'type': widget.type!,
                if (widget.today) 'today': '1',
              };
              final query = params.entries
                  .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
                  .join('&');
              final res = await session.api.get('/api/stock/transactions?$query');
              return List<Map<String, dynamic>>.from(
                  (res['transactions'] ?? []).map((e) => Map<String, dynamic>.from(e)));
            },
            builder: (context, rows, refresh) {
              if (rows.isEmpty) {
                return ListView(children: const [
                  SizedBox(height: 80),
                  Center(child: Text('No movements found.', style: TextStyle(color: Colors.grey))),
                ]);
              }
              return ListView.separated(
                itemCount: rows.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final tx = rows[i];
                  final isIn = (tx['transaction_type'] ?? '') == 'IN';
                  return ListTile(
                    leading: Icon(isIn ? Icons.south_west : Icons.north_east,
                        color: isIn ? const Color(0xFF1baf7a) : const Color(0xFFe34948)),
                    title: Text('${tx['item_code'] ?? ''} · ${tx['material_description'] ?? ''}',
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text([
                      '${tx['location_code'] ?? ''}',
                      if ((tx['reservation_number'] ?? '').toString().isNotEmpty) '${tx['reservation_number']}',
                      '${tx['user_name'] ?? ''}',
                      fmtDate(tx['transaction_date']),
                    ].where((s) => s.isNotEmpty).join(' · ')),
                    trailing: Text('${isIn ? '+' : '-'}${fmtQty(tx['quantity'])} ${tx['unit'] ?? ''}',
                        style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: isIn ? const Color(0xFF1baf7a) : const Color(0xFFe34948))),
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
