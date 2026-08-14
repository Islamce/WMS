import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/i18n.dart';

/// Small coloured pill for a workflow status.
class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) {
    final c = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: c.withValues(alpha: 0.5)),
      ),
      child: Text(status,
          style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

/// A FutureBuilder that renders loading / error (with retry) / data states,
/// with pull-to-refresh. [builder] receives the resolved data.
class AsyncView<T> extends StatefulWidget {
  const AsyncView({super.key, required this.load, required this.builder});
  final Future<T> Function() load;
  final Widget Function(BuildContext, T, VoidCallback refresh) builder;

  @override
  State<AsyncView<T>> createState() => _AsyncViewState<T>();
}

class _AsyncViewState<T> extends State<AsyncView<T>> {
  late Future<T> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.load();
  }

  void _refresh() => setState(() => _future = widget.load());

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: Padding(
            padding: EdgeInsets.all(32), child: CircularProgressIndicator()));
        }
        if (snap.hasError) {
          return _ErrorState(message: '${snap.error}', onRetry: _refresh);
        }
        return RefreshIndicator(
          onRefresh: () async => _refresh(),
          child: widget.builder(context, snap.data as T, _refresh),
        );
      },
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 60),
        const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Text(message, textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.grey)),
        ),
        const SizedBox(height: 16),
        Center(child: FilledButton.icon(
          onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry'))),
      ],
    );
  }
}

/// Toast-style snackbar helper.
void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..clearSnackBars()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? const Color(0xFFe34948) : null,
    ));
}

/// Requester / request context block — shown on every workflow step (ERP,
/// picking, GI, warehouse) so operators always see the full request details,
/// not just the request number. Accepts a request header map (or task row
/// carrying the same field names).
class RequestInfoCard extends StatelessWidget {
  const RequestInfoCard(this.r, {super.key});
  final Map<String, dynamic> r;

  String _v(String key) {
    final v = r[key] ?? (key == 'project' ? r['wbs_element'] : null);
    final s = (v ?? '').toString();
    return s.isEmpty ? '—' : s;
  }

  @override
  Widget build(BuildContext context) {
    Widget item(String label, String value) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t(label).toUpperCase(),
                style: const TextStyle(fontSize: 10, color: Colors.grey, letterSpacing: 0.5)),
            Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
          ],
        );
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Wrap(
        spacing: 20,
        runSpacing: 10,
        children: [
          item('MR Number', _v('request_number')),
          item('ERP Reservation', _v('erp_reservation_number')),
          item('ERP Reference', _v('erp_reference_number')),
          item('Movement Type', _v('movement_type')),
          item('Plant', _v('plant')),
          item('Issue Warehouse', _v('issue_warehouse_code')),
          item('Storage Location', _v('storage_location')),
          item('Requester', _v('requester_name')),
          item('Department', _v('department')),
          item('WBS / Project', _v('project')),
          item('Cost Center', _v('cost_center')),
          item('Priority', _v('priority')),
          item('Required date', _v('required_date')),
          if ((r['purpose'] ?? '').toString().isNotEmpty) item('Purpose', _v('purpose')),
        ],
      ),
    );
  }
}

/// A titled card used to group KPIs / sections.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, required this.child, this.trailing});
  final String title;
  final Widget child;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(child: Text(title,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
              if (trailing != null) trailing!,
            ]),
            const SizedBox(height: 10),
            child,
          ],
        ),
      ),
    );
  }
}
