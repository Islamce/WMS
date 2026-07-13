import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/session.dart';

/// Opens a full-screen material search backed by /api/materials/search and
/// returns the chosen material map (or null). Shared by Create Request and
/// Goods Receipt.
Future<Map<String, dynamic>?> pickMaterial(BuildContext context, Session session) {
  return showSearch<Map<String, dynamic>?>(
    context: context,
    delegate: MaterialSearchDelegate(session),
  );
}

class MaterialSearchDelegate extends SearchDelegate<Map<String, dynamic>?> {
  MaterialSearchDelegate(this.session);
  final Session session;

  @override
  String get searchFieldLabel => 'Search material code or name';

  @override
  List<Widget> buildActions(BuildContext context) =>
      [IconButton(icon: const Icon(Icons.clear), onPressed: () => query = '')];

  @override
  Widget buildLeading(BuildContext context) =>
      IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => close(context, null));

  @override
  Widget buildResults(BuildContext context) => _results();

  @override
  Widget buildSuggestions(BuildContext context) => _results();

  Widget _results() {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: () async {
        final res = await session.api
            .get('/api/materials/search?q=${Uri.encodeQueryComponent(query)}');
        return List<Map<String, dynamic>>.from(
            (res['materials'] ?? []).map((e) => Map<String, dynamic>.from(e)));
      }(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return Center(child: Text('${snap.error}', style: const TextStyle(color: Colors.grey)));
        }
        final items = snap.data ?? [];
        if (items.isEmpty) {
          return const Center(child: Text('No materials found.', style: TextStyle(color: Colors.grey)));
        }
        return ListView.separated(
          itemCount: items.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final m = items[i];
            return ListTile(
              title: Text('${m['item_code']} · ${m['description'] ?? ''}'),
              subtitle: Text('Available: ${fmtQty(m['total_available'])} ${m['unit'] ?? ''}'),
              onTap: () => close(context, m),
            );
          },
        );
      },
    );
  }
}
