import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show ThemeMode;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'i18n.dart';
import 'offline_queue.dart';
import 'push.dart';
import 'server_url.dart';

/// Holds the server URL, auth token and the signed-in user (with permissions),
/// and exposes them app-wide via [ChangeNotifier]. Persists to
/// shared_preferences so a returning user stays signed in.
class Session extends ChangeNotifier {
  static const _kToken = 'wms_token';
  static const _kUser = 'wms_user_name';
  static const _kLang = 'wms_lang';
  static const _kTheme = 'wms_theme';
  static const _kPushEnabled = 'wms_push_enabled';
  static const _kAppLock = 'wms_app_lock_enabled';
  static const _kBaseUrl = 'wms_base_url';

  /// The production server this app ships pointed at. It can be changed, but
  /// only deliberately and never invisibly — see [setBaseUrl] and
  /// core/server_url.dart.
  static const defaultBaseUrl = ServerUrl.defaultUrl;

  String baseUrl = defaultBaseUrl;
  String? token;
  Map<String, dynamic>? user;
  bool loading = true;

  /// UI language ('en' | 'ar' | 'fr') and theme preference, persisted.
  String lang = 'en';
  ThemeMode themeMode = ThemeMode.system;
  bool pushEnabled = true;

  /// Device lock (biometric/PIN/pattern) gate, entirely local — see
  /// core/app_lock.dart. [locked] is runtime-only (never persisted): it's
  /// set true at cold start whenever the feature is on, and again whenever
  /// the app is backgrounded, by the lifecycle observer in main.dart.
  bool appLockEnabled = false;
  bool locked = false;

  /// Whether the device currently has network connectivity. Requests recorded
  /// while this is false (a subset explicitly wired for it, e.g. cycle count
  /// entry) go into [queue] instead of failing outright, and are replayed
  /// automatically the moment this flips back to true.
  bool online = true;
  final OfflineQueue queue = OfflineQueue();
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  /// False whenever the app is pointed somewhere other than production, which
  /// every surface that can show it should surface loudly.
  bool get isDefaultServer => ServerUrl.isDefault(baseUrl);
  String get serverHost => ServerUrl.hostOf(baseUrl);

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

  /// Self-service display-name update. PATCH /api/auth/me — email is
  /// deliberately not editable this way (see the route's own comment).
  Future<void> updateName(String name) async {
    await api.patch('/api/auth/me', {'name': name});
    if (user != null) user!['name'] = name;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kUser, name);
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
    // A stored server is honoured only if it still passes today's rules. A
    // build that tightens them must not leave an install pointing at an
    // address it would now refuse to accept, and a device that stored one
    // under a much older build (when anything was allowed) falls back to
    // production rather than to something unreachable.
    final storedBaseUrl = prefs.getString(_kBaseUrl);
    baseUrl = (storedBaseUrl != null && ServerUrl.validationError(storedBaseUrl) == null)
        ? ServerUrl.normalize(storedBaseUrl)
        : defaultBaseUrl;
    lang = prefs.getString(_kLang) ?? 'en';
    // The product settled on English only (see public/js/i18n.js). A device that
    // stored 'ar' or 'fr' from an earlier build would otherwise flip the whole
    // app to RTL and leave most of it in English, laid out right-to-left.
    if (lang != 'en') lang = 'en';
    I18n.current = lang;
    final themeName = prefs.getString(_kTheme) ?? 'system';
    themeMode = ThemeMode.values.firstWhere((m) => m.name == themeName, orElse: () => ThemeMode.system);
    pushEnabled = prefs.getBool(_kPushEnabled) ?? true;
    appLockEnabled = prefs.getBool(_kAppLock) ?? false;
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
    locked = appLockEnabled && isAuthenticated;
    loading = false;
    notifyListeners();
  }

  /// Points the app at a different server.
  ///
  /// Signing out and emptying the offline queue are the POINT of this method,
  /// not tidying up after it. A token issued by one server means nothing to
  /// another, and a queued cycle count or goods issue recorded against one
  /// store must never replay into a different one — that is the same defect
  /// class as replaying one user's queue under the next user, which sign-out
  /// already guards against.
  ///
  /// Throws [ArgumentError] carrying the reason when [url] is not usable, so
  /// callers can put the message straight in front of the person typing.
  Future<void> setBaseUrl(String url) async {
    final problem = ServerUrl.validationError(url);
    if (problem != null) throw ArgumentError(problem);
    final next = ServerUrl.normalize(url);
    if (next == baseUrl) return;
    if (isAuthenticated) {
      // Best effort, against the OLD server and while the old token is still
      // valid: if it is unreachable that must not block the switch, which is
      // frequently the very reason somebody is switching.
      try {
        await Push.unregister(api);
      } catch (_) {
        // The server we are leaving is not required to be reachable.
      }
    }
    await queue.clear();
    token = null;
    user = null;
    locked = false;
    baseUrl = next;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBaseUrl, next);
    await prefs.remove(_kToken);
    await prefs.remove(_kUser);
    notifyListeners();
  }

  /// Back to the production server, with the same sign-out and queue clearing.
  Future<void> resetBaseUrl() => setBaseUrl(defaultBaseUrl);

  Future<void> setAppLockEnabled(bool value) async {
    appLockEnabled = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kAppLock, value);
    notifyListeners();
  }

  /// Called by main.dart's lifecycle observer when the app is backgrounded.
  void lockIfEnabled() {
    if (appLockEnabled && isAuthenticated && !locked) {
      locked = true;
      notifyListeners();
    }
  }

  /// Called after a successful device-lock authentication.
  void unlock() {
    if (!locked) return;
    locked = false;
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
    // Anything still queued belongs to the person signing out. Left in place it
    // would replay under whoever signs in next.
    await queue.clear();
    token = null;
    user = null;
    locked = false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    await prefs.remove(_kUser);
    notifyListeners();
  }
}
