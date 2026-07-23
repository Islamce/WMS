import 'package:flutter/material.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

class BatchDetailScreen extends StatelessWidget {
  const BatchDetailScreen({super.key, required this.batch});

  final Map<String, dynamic> batch;

  Widget _row(String label, dynamic value) {
    final text = value == null || value.toString().isEmpty ? '—' : value.toString();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 130, child: Text(label, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(text, style: const TextStyle(fontWeight: FontWeight.w500))),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final qrId = batch['qr_code_id'];
    final canReadQr = session.can('qr_printing') || session.can('goods_receipt');

    return Scaffold(
      appBar: AppBar(title: Text('${batch['batch_number'] ?? 'Batch'}')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          SectionCard(
            title: 'Batch identity',
            child: Column(children: [
              _row('Batch number', batch['batch_number']),
              _row('Material', '${batch['material_code'] ?? ''} · ${batch['material_description'] ?? ''}'),
              _row('Warehouse', batch['warehouse_code']),
              _row('Bin', batch['bin_location']),
              _row('PO number', batch['po_number']),
              _row('GR number', batch['gr_number']),
              _row('Supplier', batch['supplier_name'] ?? batch['supplier_code']),
            ]),
          ),
          SectionCard(
            title: 'Stock and control',
            child: Column(children: [
              _row('Received quantity', fmtQty(batch['received_quantity'])),
              _row('Remaining quantity', fmtQty(batch['remaining_quantity'])),
              _row('Reserved quantity', fmtQty(batch['reserved_quantity'])),
              _row('Available quantity', fmtQty(batch['available_quantity'] ??
                  ((batch['remaining_quantity'] ?? 0) - (batch['reserved_quantity'] ?? 0)))),
              _row('Quality status', batch['quality_status']),
              _row('Blocked reason', batch['blocked_reason']),
            ]),
          ),
          SectionCard(
            title: 'Dates and expiry',
            child: Column(children: [
              _row('Receiving date', batch['receiving_date']),
              _row('Manufacturing date', batch['manufacturing_date']),
              _row('Expiry date', batch['expiry_date']),
              _row('Days to expiry', batch['days_to_expiry']),
              _row('Alert level', batch['alert_level']),
              _row('FIFO date', batch['fifo_date']),
              _row('FEFO date', batch['fefo_date']),
            ]),
          ),
          SectionCard(
            title: 'QR and label traceability',
            child: qrId == null
                ? const Text('No QR label is linked to this batch.', style: TextStyle(color: Colors.grey))
                : canReadQr
                    ? FutureBuilder<dynamic>(
                        future: session.api.get('/api/receiving/qr/$qrId'),
                        builder: (context, snapshot) {
                          if (snapshot.connectionState != ConnectionState.done) {
                            return const Center(child: CircularProgressIndicator());
                          }
                          if (snapshot.hasError) {
                            return Text('QR detail unavailable: ${snapshot.error}',
                                style: const TextStyle(color: Colors.red));
                          }
                          final payload = Map<String, dynamic>.from(snapshot.data as Map);
                          final qr = Map<String, dynamic>.from(payload['qr'] ?? {});
                          return Column(children: [
                            _row('QR ID', qr['id']),
                            _row('QR value', qr['qr_code_value']),
                            _row('QR status', qr['status']),
                            _row('Print count', qr['print_count']),
                            _row('Last printed', qr['last_printed_at']),
                            _row('Last scanned', qr['last_scanned_at']),
                            _row('Scanned by', qr['last_scanned_by']),
                            _row('Label PDF', '/api/receiving/qr/pdf?ids=$qrId'),
                          ]);
                        },
                      )
                    : Column(children: [
                        _row('QR ID', qrId),
                        const Align(
                          alignment: Alignment.centerLeft,
                          child: Text('QR detail and PDF label require QR Printing or Goods Receipt permission.',
                              style: TextStyle(color: Colors.grey)),
                        ),
                      ]),
          ),
        ],
      ),
    );
  }
}
