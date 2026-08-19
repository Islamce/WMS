import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

final _qtyFmt = NumberFormat.decimalPattern();

String fmtQty(dynamic v) {
  if (v == null) return '0';
  final n = (v is num) ? v : num.tryParse(v.toString());
  if (n == null) return v.toString();
  return _qtyFmt.format(n);
}

String fmtDate(dynamic v) {
  if (v == null || v.toString().isEmpty) return '—';
  final s = v.toString().replaceFirst(' ', 'T');
  final d = DateTime.tryParse(s);
  if (d == null) return v.toString();
  return DateFormat('yyyy-MM-dd HH:mm').format(d.toLocal());
}

/// A stable colour for a workflow status chip, grouped by lifecycle phase.
Color statusColor(String status) {
  final s = status.toLowerCase();
  if (s.contains('reject') || s.contains('error') || s.contains('shortage') || s.contains('cancel')) {
    return const Color(0xFFe34948);
  }
  if (s.contains('complet') || s.contains('approved') || s.contains('posted') || s.contains('released')) {
    return const Color(0xFF1baf7a);
  }
  if (s.contains('pending') || s.contains('hold') || s.contains('reminder') || s.contains('await')) {
    return const Color(0xFFeda100);
  }
  return const Color(0xFF31c3c9);
}
