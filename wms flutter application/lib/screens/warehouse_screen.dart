import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Warehouse execution queue. The same queue backs Bin & Batch Assignment
/// (run FIFO/FEFO allocation) and Picker Assignment (assign a picker); [mode]
/// selects which action is offered.
enum WarehouseMode { allocate, assignPicker }

class WarehouseScreen extends StatefulWidget {
  const WarehouseScreen({super.key, required this.mode});
  final WarehouseMode mode;
  @override
  State<WarehouseScreen> createState() => _WarehouseScreenState();
}

class _WarehouseScreenState extends State<WarehouseScreen> {
  int _key = 0;
  bool _busy = false;

  bool _isAllocatable(String status) => [
        'Pending Bin Location Assignment', 'Warehouse Assigned', 'Location Assigned',
        'Batch Assigned', 'Pending Picker Assignment',
      ].contains(status);

  bool _isAssignable(String status) => [
        'Pending Picker Assignment', 'Escalated to Supervisor',
        'Assigned to Picker', 'Pending Picker Acceptance',
      ].contains(status);

  Future<void> _allocate(int id) async {
    setState(() => _busy = true);
    try {
      final res = await SessionScope.of(context).api.post('/api/warehouse/$id/allocate');
      final allocs = List<Map<String, dynamic>>.from(
          (res['allocations'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      if (mounted) {
        await showDialog(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Allocation result'),
            content: SizedBox(
              width: double.maxFinite,
              child: allocs.isEmpty
                  ? const Text('No lines allocated.')
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: allocs.map((a) {
                        final short = (a['shortfall'] ?? 0) as num;
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text('${a['material_code']} · ${a['method']}'),
                          subtitle: Text('Allocated ${a['allocated']} / ${a['requested']}'
                              '${short > 0 ? ' · shortfall $short' : ''}'),
                        );
                      }).toList(),
                    ),
            ),
            actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
          ),
        );
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _assignPicker(int id) async {
    final api = SessionScope.of(context).api;
    List<Map<String, dynamic>> pickers;
    try {
      final res = await api.get('/api/warehouse/pickers');
      pickers = List<Map<String, dynamic>>.from(
          (res['pickers'] ?? []).map((e) => Map<String, dynamic>.from(e)));
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
      return;
    }
    if (!mounted) return;
    if (pickers.isEmpty) {
      showSnack(context, 'No active pickers available.', error: true);
      return;
    }
    final pickerId = await showModalBottomSheet<int>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Assign to picker', style: TextStyle(fontWeight: FontWeight.bold))),
            ...pickers.map((p) => ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: Text('${p['name']}'),
                  subtitle: Text('${p['email'] ?? ''}'),
                  onTap: () => Navigator.pop(context, p['id'] as int),
                )),
          ],
        ),
      ),
    );
    if (pickerId == null) return;
    setState(() => _busy = true);
    try {
      await api.post('/api/warehouse/$id/assign-picker', {'picker_id': pickerId});
      if (mounted) {
        showSnack(context, 'Picker assigned.');
        setState(() => _key++);
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final allocateMode = widget.mode == WarehouseMode.allocate;
    return Stack(children: [
      AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_key),
        load: () async {
          final res = await session.api.get('/api/warehouse/queue');
          return List<Map<String, dynamic>>.from(
              (res['requests'] ?? []).map((e) => Map<String, dynamic>.from(e)));
        },
        builder: (context, rows, refresh) {
          final filtered = rows.where((r) {
            final s = '${r['request_status']}';
            return allocateMode ? _isAllocatable(s) : _isAssignable(s);
          }).toList();
          if (filtered.isEmpty) {
            return ListView(children: [
              const SizedBox(height: 80),
              Center(child: Text(
                  allocateMode ? 'No requests awaiting bin/batch assignment.' : 'No requests awaiting a picker.',
                  style: const TextStyle(color: Colors.grey))),
            ]);
          }
          return ListView(
            children: filtered.map((r) {
              final id = r['id'] as int;
              return Card(
                margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Expanded(child: Text('${r['request_number']}',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
                        StatusChip('${r['request_status']}'),
                      ]),
                      const SizedBox(height: 4),
                      Text('${r['requester_name'] ?? ''}'
                          '${(r['department'] ?? '').toString().isNotEmpty ? ' · ${r['department']}' : ''}'
                          '${(r['project'] ?? '').toString().isNotEmpty ? ' · ${r['project']}' : ''}'
                          '${(r['required_date'] ?? '').toString().isNotEmpty ? ' · req. ${r['required_date']}' : ''}',
                          style: const TextStyle(fontSize: 13)),
                      Text('WH ${r['issue_warehouse_code'] ?? ''} · MvT ${r['movement_type'] ?? ''} · '
                          '${r['total_lines'] ?? 0} line(s) · ${r['priority'] ?? ''}'),
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerRight,
                        child: FilledButton.icon(
                          icon: Icon(allocateMode ? Icons.auto_awesome_motion : Icons.person_add_alt, size: 18),
                          label: Text(allocateMode ? 'Run allocation' : 'Assign picker'),
                          onPressed: _busy ? null : () => allocateMode ? _allocate(id) : _assignPicker(id),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          );
        },
      ),
      if (_busy)
        const Positioned.fill(
          child: ColoredBox(color: Color(0x33000000), child: Center(child: CircularProgressIndicator())),
        ),
    ]);
  }
}
