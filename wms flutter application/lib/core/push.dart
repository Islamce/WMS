import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';

/// Must be a top-level function: FCM calls this in a separate isolate for
/// messages received while the app is backgrounded/terminated. The system
/// tray already shows the notification for a "notification" payload, so this
/// is intentionally a no-op — it only exists because the plugin requires a
/// registered background handler.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundMessageHandler(RemoteMessage message) async {}

/// Real device push notifications (Firebase Cloud Messaging), layered on top
/// of the in-app notification inbox — never a replacement for it. Entirely
/// optional: if the app wasn't built with a real `google-services.json` (see
/// DEPLOY-HOSTINGER.md), `Firebase.initializeApp()` throws and every method
/// here becomes a silent no-op, so the rest of the app is unaffected.
class Push {
  static bool _ready = false;
  static String? _token;

  /// Initialize Firebase, request notification permission, fetch the FCM
  /// token and register it with the backend. Call once after a successful
  /// sign-in (and on cold start if already signed in).
  static Future<void> init(ApiClient api) async {
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundMessageHandler);
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(alert: true, badge: true, sound: true);
      final token = await messaging.getToken();
      _ready = true;
      if (token != null) {
        _token = token;
        await _register(api, token);
      }
      messaging.onTokenRefresh.listen((t) {
        _token = t;
        _register(api, t);
      });
    } catch (e) {
      // No google-services.json / no Firebase project configured yet — the
      // in-app inbox (bell icon, polled every 60s) keeps working as before.
      debugPrint('[push] not available: $e');
      _ready = false;
    }
  }

  static Future<void> _register(ApiClient api, String token) async {
    try {
      await api.post('/api/notifications/register-device', {'token': token, 'platform': 'android'});
    } catch (e) {
      debugPrint('[push] device registration failed: $e');
    }
  }

  /// Unregister this device's token (call on sign-out) so a shared/reset
  /// device stops receiving another user's pushes.
  static Future<void> unregister(ApiClient api) async {
    if (!_ready || _token == null) return;
    try {
      await api.post('/api/notifications/unregister-device', {'token': _token});
    } catch (e) {
      debugPrint('[push] device unregistration failed: $e');
    }
    _token = null;
  }
}
