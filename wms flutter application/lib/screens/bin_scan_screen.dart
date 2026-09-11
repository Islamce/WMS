import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../main.dart';
import 'scan_screen.dart';

/// Scan a bin's QR/barcode label (or type its code) to see what is stored
/// there right now — materials, quantities, batch/lot and expiry — without
/// opening the full Bin Locations list. Read-only: this never changes stock.
class BinScanScreen extends StatefulWidget {
  const BinScanScreen({super.key});

  @override
  State<BinScanScreen> createState() => _BinScanScreenState();
}

class _BinScanScreenState extends State<BinScanScreen> {
  final _manualCtrl = TextEditingController();
  Map<String, dynamic>? _bin;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _manualCtrl.dispose();
    super.dispose();
  }

  Future<void> _lookup(String code) async {
    final trimmed = code.trim();
    if (trimmed.isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final session = SessionScope.of(context);
      final res = await session.api
          .get('/api/dashboard/bins/lookup?code=${Uri.encodeQueryComponent(trimmed)}');
      if (!mounted) return;
      setState(() {
        _bin = Map<String, dynamic>.from(res['bin']);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _bin = null;
        _loading = false;
        _error = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _bin = null;
        _loading = false;
        _error = t('Could not look up this bin.');
      });
    }
  }

  Future<void> _scan() async {
    final value = await Navigator.of(context).push<String>(
        MaterialPageRoute(builder: (_) => ScanScreen(title: t('Scan bin label'))));
    if (value != null && value.isNotEmpty && mounted) {
      _manualCtrl.text = value;
      await _lookup(value);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(t('Scan Bin'))),
      body: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              icon: const Icon(Icons.qr_code_scanner),
              label: Text(t('Scan bin QR / barcode')),
              onPressed: _loading ? null : _scan,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: _manualCtrl,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    labelText: t('Or enter bin code'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  onSubmitted: _lookup,
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _loading ? null : () => _lookup(_manualCtrl.text),
                child: Text(t('Go')),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (_loading)
            const Center(
              child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()),
            ),
          if (!_loading && _error != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.only(top: 20),
                child: Column(
                  children: [
                    const Icon(Icons.error_outline, size: 40, color: Colors.grey),
                    const SizedBox(height: 8),
                    Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
                  ],
                ),
              ),
            ),
          if (!_loading && _error == null && _bin != null) _BinResult(bin: _bin!),
        ],
      ),
    );
  }
}

class _BinResult extends StatelessWidget {
  const _BinResult({required this.bin});
  final Map<String, dynamic> bin;

  Widget _kv(String key, dynamic value) {
    final text = value == null || value.toString().isEmpty ? '—' : value.toString();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 130, child: Text(key, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final occupied = bin['occupancy_status'] == 'occupied';
    final materials = List<Map<String, dynamic>>.from(
        (bin['materials'] ?? []).map((e) => Map<String, dynamic>.from(e)));
    final batches = List<Map<String, dynamic>>.from(
        (bin['batches'] ?? []).map((e) => Map<String, dynamic>.from(e)));
    final flags = <String>[
      if (bin['hazard_flag'] == 1) t('Hazard'),
      if (bin['temperature_controlled_flag'] == 1) t('Temperature controlled'),
      if (bin['quality_restricted_flag'] == 1) t('Quality restricted'),
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: occupied ? const Color(0xFF1baf7a) : const Color(0xFFeda100),
                  child: Icon(occupied ? Icons.inventory_2_outlined : Icons.crop_free, color: Colors.white),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${bin['full_bin_location'] ?? bin['bin_code'] ?? '—'}',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
                      Text('${bin['warehouse_code'] ?? '—'} · ${occupied ? t('Occupied') : t('Empty')}',
                          style: const TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
                Text(fmtQty(bin['available_quantity']),
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
            const Divider(height: 24),
            _kv('Bin code', bin['bin_code']),
            _kv('Zone', bin['zone']),
            _kv('Rack', bin['rack']),
            _kv('Aisle / line', bin['line_or_aisle']),
            _kv('Level', bin['level']),
            _kv('Column', bin['column_number']),
            _kv('Capacity', fmtQty(bin['capacity'])),
            _kv('Available quantity', fmtQty(bin['available_quantity'])),
            _kv('Batches', bin['batch_count']),
            _kv('Materials', bin['material_count']),
            if (flags.isNotEmpty) _kv('Restrictions', flags.join(', ')),
            if (materials.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.only(top: 10, bottom: 4),
                child: Text(t('Contents'), style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              ...materials.map((m) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text('${m['material_code'] ?? ''} — ${m['material_description'] ?? ''}',
                              overflow: TextOverflow.ellipsis),
                        ),
                        Text('${fmtQty(m['quantity'])} ${m['unit'] ?? ''}',
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                      ],
                    ),
                  )),
            ],
            if (batches.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.only(top: 14, bottom: 4),
                child: Text(t('Batch / lot detail'), style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              ...batches.map((b) => Container(
                    margin: const EdgeInsets.symmetric(vertical: 3),
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text('${b['material_code'] ?? ''} · ${t('Batch')} ${b['batch_number'] ?? ''}',
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                  overflow: TextOverflow.ellipsis),
                            ),
                            Text('${fmtQty(b['remaining_quantity'])} ${b['unit'] ?? ''}'),
                          ],
                        ),
                        Text(
                          '${t('Expiry')}: ${b['expiry_date'] ?? '—'} · ${t('Quality')}: ${b['quality_status'] ?? '—'}',
                          style: const TextStyle(color: Colors.grey, fontSize: 12),
                        ),
                      ],
                    ),
                  )),
            ],
          ],
        ),
      ),
    );
  }
}
