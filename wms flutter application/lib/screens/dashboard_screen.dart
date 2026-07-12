import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return AsyncView<Map<String, dynamic>>(
      load: () async => Map<String, dynamic>.from(await session.api.get('/api/dashboard')),
      builder: (context, data, refresh) {
        final k = Map<String, dynamic>.from(data['kpis'] ?? {});
        final tiles = <_Kpi>[
          _Kpi('Materials', k['total_materials'], Icons.inventory_2_outlined, const Color(0xFF2a78d6)),
          _Kpi('Total Stock', k['total_stock'], Icons.warehouse_outlined, const Color(0xFF1baf7a)),
          _Kpi('Bin Locations', k['total_locations'], Icons.grid_view_outlined, const Color(0xFF2a78d6)),
          _Kpi('Occupied Bins', k['occupied_locations'], Icons.inventory_outlined, const Color(0xFF1baf7a)),
          _Kpi('Empty Bins', k['empty_locations'], Icons.crop_free, const Color(0xFFeda100)),
          _Kpi('Stock In (today)', k['stock_in_today'], Icons.south_west, const Color(0xFF1baf7a)),
          _Kpi('Stock Out (today)', k['stock_out_today'], Icons.north_east, const Color(0xFFe34948)),
          _Kpi('Pending Users', k['pending_users'], Icons.how_to_reg_outlined, const Color(0xFFeda100)),
        ];
        final recent = List<Map<String, dynamic>>.from(
            (data['recent_transactions'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        final topMaterials = List<Map<String, dynamic>>.from(
            (data['top_materials'] ?? []).map((e) => Map<String, dynamic>.from(e)));

        return ListView(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: 1.6,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                children: tiles.map((t) => _KpiCard(t)).toList(),
              ),
            ),
            if (topMaterials.isNotEmpty)
              SectionCard(
                title: 'Top materials by stock',
                child: Column(
                  children: topMaterials.take(8).map((m) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text('${m['item_code']} · ${m['description'] ?? ''}',
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    trailing: Text('${fmtQty(m['quantity'])} ${m['unit'] ?? ''}',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  )).toList(),
                ),
              ),
            SectionCard(
              title: 'Recent movements',
              child: recent.isEmpty
                  ? const Text('No transactions yet.', style: TextStyle(color: Colors.grey))
                  : Column(
                      children: recent.map((tx) {
                        final isIn = (tx['transaction_type'] ?? '') == 'IN';
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(isIn ? Icons.south_west : Icons.north_east,
                              color: isIn ? const Color(0xFF1baf7a) : const Color(0xFFe34948)),
                          title: Text('${tx['item_code'] ?? ''} · ${tx['material_description'] ?? ''}',
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Text('${tx['location_code'] ?? ''} · ${fmtDate(tx['transaction_date'])}'),
                          trailing: Text('${isIn ? '+' : '-'}${fmtQty(tx['quantity'])}',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: isIn ? const Color(0xFF1baf7a) : const Color(0xFFe34948))),
                        );
                      }).toList(),
                    ),
            ),
            const SizedBox(height: 20),
          ],
        );
      },
    );
  }
}

class _Kpi {
  const _Kpi(this.label, this.value, this.icon, this.color);
  final String label;
  final dynamic value;
  final IconData icon;
  final Color color;
}

class _KpiCard extends StatelessWidget {
  const _KpiCard(this.kpi);
  final _Kpi kpi;
  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(children: [
              Icon(kpi.icon, color: kpi.color, size: 20),
              const Spacer(),
              Flexible(
                child: Text(fmtQty(kpi.value),
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: kpi.color)),
              ),
            ]),
            const SizedBox(height: 6),
            Text(kpi.label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}
