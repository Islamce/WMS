import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show ThemeMode;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'i18n.dart';
import 'offline_queue.dart';
import 'push.dart';

/// Holds the server URL, auth token and the signed-in user (with permissions),
/// and exposes them app-wide via [ChangeNotifier]. Persists to
/// shared_preferences so a returning user stays signed in.
class Session extends ChangeNotifier {
  static const _kToken = 'wms_token';
  static const _kUser = 'wms_user_name';
  static const _kLang = 'wms_lang';
  static const _kTheme = 'wms_theme';
  static const _kPushEnabled = 'wms_push_enabled';

  /// The one production server this app talks to — embedded, not user-editable.
  static const defaultBaseUrl = 'https://wms.kynox.io';

  String baseUrl = defaultBaseUrl;
  String? token;
  Map<String, dynamic>? user;
  bool loading = true;

  /// UI language ('en' | 'ar' | 'fr') and theme preference, persisted.
  String lang = 'en';
  ThemeMode themeMode = ThemeMode.system;
  bool pushEnabled = true;

  /// Whether the device currently has network connectivity. Requests recorded
  /// while this is false (a subset explicitly wired for it, e.g. cycle count
  /// entry) go into [queue] instead of failing outright, and are replayed
  /// automatically the moment this flips back to true.
  bool online = true;
  final OfflineQueue queue = OfflineQueue();
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  bool get isAuthenticated => token != null && token!.isNotEmpty && user != null;
  String get userName => (user?['name'] ?? '').toString();
  String get userRole => (user?['role'] ?? '').toString();
  bool get mustChangePassword => user?['must_change_password'] == true;

  /// Called after a successful password change so the forced-change gate
  /// (mirrors the web app's) lifts immediately without a re-login.
  void clearMustChangePassword() {
    if (user != null) user!['must_change_password'] = false;
    notifyListeners();
  }

  List<String> get permissions {
    final p = user?['permissions'];
    if (p is List) return p.map((e) => e.toString()).toList();
    return const [];
  }

  /// Mirrors the web app's `App.can()` — a string or list; admin has all.
  /// A `null` permission means "any signed-in user" (the Home launchpad).
  bool can(dynamic permission) {
    if (permission == null) return true;
    if (userRole == 'admin') return true;
    final perms = permissions;
    if (permission is List) {
      return permission.any((p) => perms.contains(p.toString()));
    }
    return perms.contains(permission.toString());
  }

  ApiClient get api => ApiClient(baseUrl: baseUrl, token: token);

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    // baseUrl is always the embedded production server — earlier builds let
    // it be changed in Settings/at login, but any value stored by those is
    // now ignored so every install talks to the same server.
    lang = prefs.getString(_kLang) ?? 'en';
    I18n.current = lang;
    final themeName = prefs.getString(_kTheme) ?? 'system';
    themeMode = ThemeMode.values.firstWhere((m) => m.name == themeName, orElse: () => ThemeMode.system);
    pushEnabled = prefs.getBool(_kPushEnabled) ?? true;
    token = prefs.getString(_kToken);
    final name = prefs.getString(_kUser);
    await queue.load();
    _initConnectivity();
    // Re-validate the token against /auth/me so permissions are always fresh.
    if (token != null && token!.isNotEmpty) {
      try {
        final res = await ApiClient(baseUrl: baseUrl, token: token).get('/api/auth/me');
        user = Map<String, dynamic>.from(res['user'] as Map);
        if (pushEnabled) Push.init(api); // fire-and-forget — never blocks app startup
      } catch (_) {
        // token invalid/expired or server unreachable — fall back to name only
        if (name != null) user = {'name': name, 'permissions': []};
        token = null;
      }
    }
    loading = false;
    notifyListeners();
  }

  /// Watches device connectivity and auto-replays the offline queue the
  /// moment the app is back online. `connectivity_plus` only reports whether
  /// a network interface is up, not real internet reachability, so a change
  /// to "online" also triggers a queue flush attempt rather than being
  /// trusted blindly — flush() itself detects a still-unreachable server.
  void _initConnectivity() {
    _connectivitySub?.cancel();
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final nowOnline = !results.contains(ConnectivityResult.none);
      if (nowOnline == online) return;
      online = nowOnline;
      notifyListeners();
      if (online) flushQueue();
    });
    Connectivity().checkConnectivity().then((results) {
      online = !results.contains(ConnectivityResult.none);
      notifyListeners();
    });
  }

  /// Replays anything recorded while offline. Safe to call anytime (e.g. a
  /// manual "Sync now" in Settings, or after `_initConnectivity` sees a
  /// reconnect) — it's a no-op when the queue is empty.
  Future<void> flushQueue() async {
    if (await queue.flush(api)) notifyListeners();
  }

  /// Records a write made while offline (or one that just failed because the
  /// server is unreachable) so it can be replayed once connectivity returns,
  /// and notifies listeners so any "pending sync" UI updates immediately.
  Future<void> enqueueOffline({
    required String method,
    required String path,
    required Map<String, dynamic> body,
    required String description,
  }) async {
    await queue.enqueue(method: method, path: path, body: body, description: description);
    online = false;
    notifyListeners();
  }

  Future<void> setPushEnabled(bool value) async {
    pushEnabled = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kPushEnabled, value);
    if (value) {
      if (isAuthenticated) Push.init(api);
    } else {
      await Push.unregister(api);
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _connectivitySub?.cancel();
    super.dispose();
  }

  Future<void> setLang(String value) async {
    lang = value;
    I18n.current = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLang, value);
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    themeMode = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kTheme, mode.name);
    notifyListeners();
  }

  Future<void> signIn(String email, String password) async {
    final res = await ApiClient(baseUrl: baseUrl).post('/api/auth/login', {
      'email': email.trim(),
      'password': password,
    });
    token = res['token'] as String;
    user = Map<String, dynamic>.from(res['user'] as Map);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kToken, token!);
    await prefs.setString(_kUser, userName);
    if (pushEnabled) Push.init(api); // fire-and-forget — never blocks login
    notifyListeners();
  }

  Future<void> signOut() async {
    await Push.unregister(api); // uses the still-valid token/api
    token = null;
    user = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    await prefs.remove(_kUser);
    notifyListeners();
  }
}
