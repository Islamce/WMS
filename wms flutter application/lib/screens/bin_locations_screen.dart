import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';
import 'bin_scan_screen.dart';

class BinLocationsScreen extends StatelessWidget {
  const BinLocationsScreen({super.key, required this.status});

  final String status;

  String get _title {
    switch (status) {
      case 'occupied':
        return 'Occupied Bins';
      case 'empty':
        return 'Empty Bins';
      default:
        return 'Bin Locations';
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(_title),
        actions: [
          IconButton(
            tooltip: 'Scan a bin',
            icon: const Icon(Icons.qr_code_scanner),
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const BinScanScreen())),
          ),
        ],
      ),
      body: AsyncView<List<Map<String, dynamic>>>(
        load: () async {
          final res = await session.api.get('/api/dashboard/bins?status=$status');
          return List<Map<String, dynamic>>.from(
              (res['bins'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, bins, refresh) {
          if (bins.isEmpty) {
            return Center(
              child: Text('No ${status == 'all' ? '' : '$status '}bins found.',
                  style: const TextStyle(color: Colors.grey)),
            );
          }
          return RefreshIndicator(
            onRefresh: () async => refresh(),
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: bins.length,
              itemBuilder: (context, index) {
                final b = bins[index];
                final occupied = b['occupancy_status'] == 'occupied';
                final materials = List<Map<String, dynamic>>.from(
                    (b['materials'] ?? []).map((e) => Map<String, dynamic>.from(e)));
                final flags = <String>[
                  if (b['hazard_flag'] == 1) 'Hazard',
                  if (b['temperature_controlled_flag'] == 1) 'Temperature controlled',
                  if (b['quality_restricted_flag'] == 1) 'Quality restricted',
                ];
                return Card(
                  child: ExpansionTile(
                    leading: CircleAvatar(
                      child: Icon(occupied ? Icons.inventory_2_outlined : Icons.crop_free),
                    ),
                    title: Text('${b['full_bin_location'] ?? b['bin_code'] ?? '—'}',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${b['warehouse_code'] ?? '—'} · ${occupied ? 'Occupied' : 'Empty'}'),
                    trailing: Text(fmtQty(b['available_quantity']),
                        style: const TextStyle(fontWeight: FontWeight.bold)),
                    childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                    children: [
                      _kv('Bin code', b['bin_code']),
                      _kv('Zone', b['zone']),
                      _kv('Rack', b['rack']),
                      _kv('Aisle / line', b['line_or_aisle']),
                      _kv('Level', b['level']),
                      _kv('Column', b['column_number']),
                      _kv('Capacity', fmtQty(b['capacity'])),
                      _kv('Available quantity', fmtQty(b['available_quantity'])),
                      _kv('Batches', b['batch_count']),
                      _kv('Materials', b['material_count']),
                      if (flags.isNotEmpty) _kv('Restrictions', flags.join(', ')),
                      if (materials.isNotEmpty) ...[
                        const Padding(
                          padding: EdgeInsets.only(top: 8, bottom: 4),
                          child: Text('Contents', style: TextStyle(fontWeight: FontWeight.w600)),
                        ),
                        ...materials.map((m) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                        '${m['material_code'] ?? ''} — ${m['material_description'] ?? ''}',
                                        overflow: TextOverflow.ellipsis),
                                  ),
                                  Text('${fmtQty(m['quantity'])} ${m['unit'] ?? ''}',
                                      style: const TextStyle(fontWeight: FontWeight.w600)),
                                ],
                              ),
                            )),
                      ],
                    ],
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }

  Widget _kv(String key, dynamic value) {
    final text = value == null || value.toString().isEmpty ? '—' : value.toString();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 125, child: Text(key, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
