import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../core/i18n.dart';

/// Full-screen camera scanner. Pops with the first detected barcode/QR value.
/// Supports QR, Code128, EAN-13 and DataMatrix (GS1) — the formats used on
/// WMS batch labels, bin labels and supplier packaging.
///
/// Usage:
///   final value = await Navigator.push<String>(context,
///       MaterialPageRoute(builder: (_) => const ScanScreen()));
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, this.title});
  final String? title;

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final MobileScannerController _controller = MobileScannerController(
    formats: const [
      BarcodeFormat.qrCode,
      BarcodeFormat.code128,
      BarcodeFormat.ean13,
      BarcodeFormat.dataMatrix,
    ],
  );
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_done) return;
    for (final barcode in capture.barcodes) {
      final value = barcode.rawValue;
      if (value != null && value.isNotEmpty) {
        _done = true;
        Navigator.of(context).pop(value);
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title ?? t('Scan QR / barcode')),
        actions: [
          IconButton(
            tooltip: t('Toggle torch'),
            icon: const Icon(Icons.flash_on_outlined),
            onPressed: () => _controller.toggleTorch(),
          ),
          IconButton(
            tooltip: t('Switch camera'),
            icon: const Icon(Icons.cameraswitch_outlined),
            onPressed: () => _controller.switchCamera(),
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          // Simple viewfinder frame.
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white70, width: 2),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 32,
            child: Text(
              t('Point the camera at the batch or bin label'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, shadows: [Shadow(blurRadius: 6)]),
            ),
          ),
        ],
      ),
    );
  }
}
