import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

/// A write request recorded while offline, waiting to be replayed against the
/// server once connectivity returns.
class QueuedRequest {
  QueuedRequest({
    required this.id,
    required this.method,
    required this.path,
    required this.body,
    required this.description,
    required this.createdAt,
  });

  final String id;
  final String method; // 'POST' | 'PATCH' | 'PUT'
  final String path;
  final Map<String, dynamic> body;
  final String description; // shown to the user, e.g. "Cycle count #42"
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
        'id': id, 'method': method, 'path': path, 'body': body,
        'description': description, 'createdAt': createdAt.toIso8601String(),
      };

  factory QueuedRequest.fromJson(Map<String, dynamic> j) => QueuedRequest(
        id: j['id'] as String,
        method: j['method'] as String,
        path: j['path'] as String,
        body: Map<String, dynamic>.from(j['body'] as Map),
        description: j['description'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}

/// Persists write requests made while offline and replays them, in order,
/// once the app is back online. Backed by shared_preferences so queued work
/// survives an app restart.
///
/// Only wire this up for requests that are safe to record blind and replay
/// later (e.g. "record this count") — not for actions whose correctness
/// depends on state the device couldn't see while offline.
class OfflineQueue {
  static const _kQueue = 'wms_offline_queue';
  static const _kErrors = 'wms_offline_queue_errors';

  final List<QueuedRequest> _pending = [];
  final List<String> _errors = []; // human-readable: requests the server rejected on replay

  List<QueuedRequest> get pending => List.unmodifiable(_pending);
  List<String> get errors => List.unmodifiable(_errors);

  QueuedRequest? findByPath(String path) {
    for (final r in _pending) {
      if (r.path == path) return r;
    }
    return null;
  }

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kQueue);
    if (raw != null) {
      _pending
        ..clear()
        ..addAll((jsonDecode(raw) as List)
            .map((e) => QueuedRequest.fromJson(Map<String, dynamic>.from(e))));
    }
    _errors
      ..clear()
      ..addAll(List<String>.from(jsonDecode(prefs.getString(_kErrors) ?? '[]')));
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kQueue, jsonEncode(_pending.map((r) => r.toJson()).toList()));
    await prefs.setString(_kErrors, jsonEncode(_errors));
  }

  Future<void> enqueue({
    required String method,
    required String path,
    required Map<String, dynamic> body,
    required String description,
  }) async {
    _pending.add(QueuedRequest(
      id: '${DateTime.now().microsecondsSinceEpoch}',
      method: method, path: path, body: body, description: description,
      createdAt: DateTime.now(),
    ));
    await _persist();
  }

  Future<void> clearErrors() async {
    _errors.clear();
    await _persist();
  }

  /// Replays queued requests in order. Stops at the first one that still
  /// can't reach the server (still offline) so ordering is preserved; a
  /// request the server rejects outright (e.g. already superseded) is
  /// dropped and recorded under [errors] instead of retried forever.
  ///
  /// Returns true if anything changed (for callers deciding whether to
  /// refresh a list).
  Future<bool> flush(ApiClient api) async {
    if (_pending.isEmpty) return false;
    var changed = false;
    while (_pending.isNotEmpty) {
      final req = _pending.first;
      try {
        switch (req.method) {
          case 'PATCH':
            await api.patch(req.path, req.body);
            break;
          case 'PUT':
            await api.put(req.path, req.body);
            break;
          default:
            await api.post(req.path, req.body);
        }
        _pending.removeAt(0);
        changed = true;
      } on ApiException catch (e) {
        if (e.statusCode == 0) break; // still unreachable — stop, keep order, retry later
        _pending.removeAt(0);
        _errors.add('${req.description}: ${e.message}');
        changed = true;
      }
    }
    if (changed) await _persist();
    return changed;
  }
}
