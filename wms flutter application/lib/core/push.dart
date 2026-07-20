import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api_client.dart';
import '../screens/request_detail_screen.dart';

/// Real device push notifications (Firebase Cloud Messaging).
///
/// Delivery strategy — DATA-ONLY messages rendered locally in every state:
/// the backend sends a data-only FCM payload (no `notification` block), so FCM
/// never auto-displays anything. This app renders each message itself through
/// [flutter_local_notifications] in all three states — foreground
/// ([FirebaseMessaging.onMessage]), background and terminated (the top-level
/// [firebaseBackgroundMessageHandler]). That guarantees exactly one system-tray
/// notification per message (no FCM + local duplicate), on one stable channel
/// with High importance, and full control over tap routing.
///
/// Entirely optional: if the app wasn't built with a real `google-services.json`
/// (see DEPLOY-HOSTINGER.md) `Firebase.initializeApp()` throws and every method
/// here becomes a silent no-op, so the in-app inbox (bell icon) is unaffected.

/// Stable Android notification channel — created before any notification is
/// shown, and named in AndroidManifest.xml as the FCM fallback channel.
const AndroidNotificationChannel _kChannel = AndroidNotificationChannel(
  'wms_notifications',
  'WMS Notifications',
  description: 'Warehouse request, approval, picking and delivery alerts.',
  importance: Importance.high,
);

final FlutterLocalNotificationsPlugin _fln = FlutterLocalNotificationsPlugin();
bool _localReady = false;

/// Idempotently initialize the local-notifications plugin and create the
/// Android channel. Safe to call from both the main isolate and the background
/// isolate (FCM runs the background handler in a separate isolate, so the
/// plugin must be set up there too).
Future<void> _ensureLocalNotifications() async {
  if (_localReady) return;
  const init = InitializationSettings(
    android: AndroidInitializationSettings('@mipmap/ic_launcher'),
  );
  await _fln.initialize(
    settings: init,
    onDidReceiveNotificationResponse: (resp) => _routeFromPayload(resp.payload),
  );
  await _fln
      .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      ?.createNotificationChannel(_kChannel);
  _localReady = true;
}

/// Build and show a tray notification from an FCM data message. Used by the
/// foreground, background and terminated code paths alike.
Future<void> _show(RemoteMessage message) async {
  await _ensureLocalNotifications();
  final data = message.data;
  final title = (data['title'] ?? 'WMS').toString();
  final body = (data['body'] ?? '').toString();
  final details = NotificationDetails(
    android: AndroidNotificationDetails(
      _kChannel.id,
      _kChannel.name,
      channelDescription: _kChannel.description,
      importance: Importance.high,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
    ),
  );
  // Stable-ish id from the message so the same message doesn't stack; fall back
  // to a time-based id when FCM gives no message id.
  final id = (message.messageId?.hashCode ?? DateTime.now().millisecondsSinceEpoch) & 0x7fffffff;
  await _fln.show(
    id: id,
    title: title,
    body: body,
    notificationDetails: details,
    payload: jsonEncode(data),
  );
  debugPrint('[push] notification displayed id=$id');
}

/// Top-level (required) handler FCM invokes in a separate isolate for messages
/// received while the app is backgrounded or terminated. For a data-only
/// payload FCM shows nothing itself, so we render the notification here.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundMessageHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
    debugPrint('[push] background message received');
    await _show(message);
  } catch (e) {
    debugPrint('[push] background handler error: $e');
  }
}

class Push {
  static bool _ready = false;
  static String? _token;

  /// Set by main.dart onto MaterialApp so notification taps can navigate.
  static final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  /// Initialize Firebase, set up local notifications + channel, request
  /// notification permission (incl. Android 13+ POST_NOTIFICATIONS), fetch the
  /// FCM token and register it with the backend. Call once after a successful
  /// sign-in (and on cold start if already signed in).
  static Future<void> init(ApiClient api) async {
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundMessageHandler);
      await _ensureLocalNotifications();

      final messaging = FirebaseMessaging.instance;
      // iOS/general permission prompt…
      await messaging.requestPermission(alert: true, badge: true, sound: true);
      // …and the Android 13+ runtime POST_NOTIFICATIONS prompt.
      await _fln
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();

      // Foreground messages: FCM does not display data-only payloads, so render.
      FirebaseMessaging.onMessage.listen((m) {
        debugPrint('[push] foreground message received');
        _show(m);
      });
      // Taps that bring a backgrounded app to the foreground.
      FirebaseMessaging.onMessageOpenedApp.listen((m) {
        debugPrint('[push] notification opened (background)');
        _routeFromData(m.data);
      });
      // Tap that cold-started the app from terminated.
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        debugPrint('[push] notification opened (terminated launch)');
        _routeFromData(initial.data);
      }

      final token = await messaging.getToken();
      _ready = true;
      if (token != null) {
        _token = token;
        debugPrint('[push] token generated (len=${token.length})');
        await _register(api, token);
      }
      messaging.onTokenRefresh.listen((t) {
        _token = t;
        debugPrint('[push] token refreshed (len=${t.length})');
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

/// Decode a tapped local-notification payload (JSON of the FCM data map) and
/// route from it.
void _routeFromPayload(String? payload) {
  if (payload == null || payload.isEmpty) return;
  try {
    final data = Map<String, dynamic>.from(jsonDecode(payload) as Map);
    _routeFromData(data);
  } catch (_) {/* malformed payload — just open the app */}
}

/// Navigate to the relevant screen from a message's data map, when routing
/// hints are present. Unknown/absent hints simply leave the app on its current
/// screen (the tap already brought it to the foreground).
void _routeFromData(Map<String, dynamic> data) {
  debugPrint('[push] notification opened');
  final nav = Push.navigatorKey.currentState;
  if (nav == null) return;
  final route = (data['route'] ?? '').toString();
  final requestId = int.tryParse((data['requestId'] ?? '').toString());
  if (route == 'request' && requestId != null) {
    nav.push(MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: requestId)));
  }
}
