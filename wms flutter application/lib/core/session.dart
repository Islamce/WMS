import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show ThemeMode;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'i18n.dart';
import 'push.dart';

/// Holds the server URL, auth token and the signed-in user (with permissions),
/// and exposes them app-wide via [ChangeNotifier]. Persists to
/// shared_preferences so a returning user stays signed in.
class Session extends ChangeNotifier {
  static const _kBaseUrl = 'wms_base_url';
  static const _kToken = 'wms_token';
  static const _kUser = 'wms_user_name';
  static const _kLang = 'wms_lang';
  static const _kTheme = 'wms_theme';

  /// Production server — baked in so the app works out of the box; it can
  /// still be changed under Settings (e.g. for a dev/test server).
  static const defaultBaseUrl = 'https://wms.kynox.io';

  String baseUrl = defaultBaseUrl;
  String? token;
  Map<String, dynamic>? user;
  bool loading = true;

  /// UI language ('en' | 'ar' | 'fr') and theme preference, persisted.
  String lang = 'en';
  ThemeMode themeMode = ThemeMode.system;

  bool get isAuthenticated => token != null && token!.isNotEmpty && user != null;
  String get userName => (user?['name'] ?? '').toString();
  String get userRole => (user?['role'] ?? '').toString();

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
    baseUrl = prefs.getString(_kBaseUrl) ?? baseUrl;
    // Older builds defaulted to the Android-emulator loopback; migrate those
    // installs to the production server automatically.
    if (baseUrl == 'http://10.0.2.2:3000') baseUrl = defaultBaseUrl;
    lang = prefs.getString(_kLang) ?? 'en';
    I18n.current = lang;
    final themeName = prefs.getString(_kTheme) ?? 'system';
    themeMode = ThemeMode.values.firstWhere((m) => m.name == themeName, orElse: () => ThemeMode.system);
    token = prefs.getString(_kToken);
    final name = prefs.getString(_kUser);
    // Re-validate the token against /auth/me so permissions are always fresh.
    if (token != null && token!.isNotEmpty) {
      try {
        final res = await ApiClient(baseUrl: baseUrl, token: token).get('/api/auth/me');
        user = Map<String, dynamic>.from(res['user'] as Map);
        Push.init(api); // fire-and-forget — never blocks app startup
      } catch (_) {
        // token invalid/expired or server unreachable — fall back to name only
        if (name != null) user = {'name': name, 'permissions': []};
        token = null;
      }
    }
    loading = false;
    notifyListeners();
  }

  Future<void> setBaseUrl(String url) async {
    baseUrl = url.trim();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBaseUrl, baseUrl);
    notifyListeners();
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
    Push.init(api); // fire-and-forget — never blocks login
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
