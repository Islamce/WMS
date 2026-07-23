import 'dart:io';

import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../core/format.dart';
import '../main.dart';
import '../widgets/common.dart';

class BatchDetailScreen extends StatefulWidget {
  const BatchDetailScreen({super.key, required this.batch});

  final Map<String, dynamic> batch;

  @override
  State<BatchDetailScreen> createState() => _BatchDetailScreenState();
}

class _BatchDetailScreenState extends State<BatchDetailScreen> {
  bool _openingPdf = false;

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

  Widget _eventTile(Map<String, dynamic> event) {
    final title = event['action'] ?? event['transaction_type'] ?? event['status'] ?? 'Event';
    final time = event['changed_at'] ?? event['transaction_date'] ?? event['created_at'];
    final source = event['source_screen'] ?? event['warehouse_code'] ?? event['from_warehouse'];
    final detail = event['reason'] ?? event['notes'] ?? event['scan_result'] ?? event['to_warehouse'];
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.history, size: 20),
      title: Text('$title', style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text([
        if (source != null && source.toString().isNotEmpty) source,
        if (detail != null && detail.toString().isNotEmpty) detail,
        if (time != null && time.toString().isNotEmpty) time,
      ].join(' · ')),
    );
  }

  Future<void> _openPdf(String path, String batchNumber) async {
    if (_openingPdf) return;
    setState(() => _openingPdf = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final session = SessionScope.of(context);
      final bytes = await session.api.downloadBytes(path, expectedContentType: 'application/pdf');
      final dir = await getTemporaryDirectory();
      final safeName = batchNumber.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
      final file = File('${dir.path}/$safeName-qr-label.pdf');
      await file.writeAsBytes(bytes, flush: true);
      final result = await OpenFilex.open(file.path, type: 'application/pdf');
      if (result.type != ResultType.done) {
        throw Exception(result.message.isEmpty ? 'No PDF viewer is available.' : result.message);
      }
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('Unable to open QR PDF: $e')));
    } finally {
      if (mounted) setState(() => _openingPdf = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final canReadQr = session.can('qr_printing') || session.can('goods_receipt');

    return Scaffold(
      appBar: AppBar(title: Text('${widget.batch['batch_number'] ?? 'Batch'}')),
      body: FutureBuilder<dynamic>(
        future: session.api.get('/api/receiving/batches/${widget.batch['id']}/traceability'),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text('Batch traceability unavailable: ${snapshot.error}',
                  textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
            ));
          }

          final payload = Map<String, dynamic>.from(snapshot.data as Map);
          final b = Map<String, dynamic>.from(payload['batch'] ?? widget.batch);
          final qr = payload['qr'] == null ? <String, dynamic>{} : Map<String, dynamic>.from(payload['qr']);
          final summary = Map<String, dynamic>.from(payload['summary'] ?? {});
          final allocations = List<Map<String, dynamic>>.from(
              (payload['allocations'] ?? []).map((e) => Map<String, dynamic>.from(e)));
          final reallocations = List<Map<String, dynamic>>.from(
              (payload['reallocations'] ?? []).map((e) => Map<String, dynamic>.from(e)));
          final movements = List<Map<String, dynamic>>.from(
              (payload['movements'] ?? []).map((e) => Map<String, dynamic>.from(e)));
          final audit = List<Map<String, dynamic>>.from(
              (payload['events'] ?? []).map((e) => Map<String, dynamic>.from(e)));
          final pdfPath = qr['pdf_path']?.toString();

          return ListView(
            padding: const EdgeInsets.all(12),
            children: [
              SectionCard(
                title: 'Batch identity',
                child: Column(children: [
                  _row('Batch number', b['batch_number']),
                  _row('Material', '${b['material_code'] ?? ''} · ${b['material_description'] ?? ''}'),
                  _row('Warehouse', b['warehouse_code']),
                  _row('Bin', b['bin_location']),
                  _row('PO number', b['po_number']),
                  _row('GR number', b['gr_number']),
                  _row('Supplier', b['supplier_name'] ?? b['supplier_code']),
                ]),
              ),
              SectionCard(
                title: 'Stock and control',
                child: Column(children: [
                  _row('Received quantity', fmtQty(b['received_quantity'])),
                  _row('Remaining quantity', fmtQty(b['remaining_quantity'])),
                  _row('Reserved quantity', fmtQty(b['reserved_quantity'])),
                  _row('Available quantity', fmtQty(b['available_quantity'])),
                  _row('Quality status', b['quality_status']),
                  _row('Blocked reason', b['blocked_reason']),
                ]),
              ),
              SectionCard(
                title: 'Dates and expiry',
                child: Column(children: [
                  _row('Receiving date', b['receiving_date']),
                  _row('Manufacturing date', b['manufacturing_date']),
                  _row('Expiry date', b['expiry_date']),
                  _row('Days to expiry', b['days_to_expiry']),
                  _row('Alert level', b['alert_level']),
                  _row('FIFO date', b['fifo_date']),
                  _row('FEFO date', b['fefo_date']),
                ]),
              ),
              SectionCard(
                title: 'QR and label traceability',
                child: qr.isEmpty
                    ? const Text('No QR label is linked to this batch.', style: TextStyle(color: Colors.grey))
                    : canReadQr
                        ? Column(children: [
                            _row('QR ID', qr['id']),
                            _row('QR value', qr['qr_code_value']),
                            _row('QR status', qr['qr_status'] ?? qr['status']),
                            _row('Print count', qr['print_count']),
                            _row('Last printed', qr['printed_at'] ?? qr['last_printed_at']),
                            _row('Last scanned', qr['last_scanned_at']),
                            _row('Scanned by', qr['last_scanned_by']),
                            if (pdfPath != null && pdfPath.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: SizedBox(
                                  width: double.infinity,
                                  child: FilledButton.icon(
                                    onPressed: _openingPdf
                                        ? null
                                        : () => _openPdf(pdfPath, b['batch_number']?.toString() ?? 'batch'),
                                    icon: _openingPdf
                                        ? const SizedBox.square(
                                            dimension: 18,
                                            child: CircularProgressIndicator(strokeWidth: 2),
                                          )
                                        : const Icon(Icons.picture_as_pdf),
                                    label: Text(_openingPdf ? 'Opening PDF…' : 'Download and open QR PDF'),
                                  ),
                                ),
                              ),
                          ])
                        : Column(children: [
                            _row('QR ID', qr['id']),
                            const Align(
                              alignment: Alignment.centerLeft,
                              child: Text('QR detail and PDF label require QR Printing or Goods Receipt permission.',
                                  style: TextStyle(color: Colors.grey)),
                            ),
                          ]),
              ),
              SectionCard(
                title: 'Traceability summary',
                child: Column(children: [
                  _row('Prints', summary['qr_print_count'] ?? summary['print_count']),
                  _row('Picking allocations', summary['allocation_count']),
                  _row('Reallocations', summary['reallocation_count']),
                  _row('Stock movements', summary['movement_count']),
                  _row('Audit events', summary['event_count'] ?? summary['audit_count']),
                ]),
              ),
              if (allocations.isNotEmpty)
                SectionCard(
                  title: 'Picking and scanning',
                  child: Column(children: allocations.map(_eventTile).toList()),
                ),
              if (reallocations.isNotEmpty)
                SectionCard(
                  title: 'Reallocation history',
                  child: Column(children: reallocations.map(_eventTile).toList()),
                ),
              if (movements.isNotEmpty)
                SectionCard(
                  title: 'Stock movement history',
                  child: Column(children: movements.map(_eventTile).toList()),
                ),
              if (audit.isNotEmpty)
                SectionCard(
                  title: 'Audit timeline',
                  child: Column(children: audit.map(_eventTile).toList()),
                ),
            ],
          );
        },
      ),
    );
  }
}
