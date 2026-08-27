import 'package:local_auth/local_auth.dart';

/// Thin wrapper around the device's own biometric/PIN/pattern/password
/// screen. The app never stores or checks a credential itself — it only asks
/// the OS "did this device's owner just prove who they are", which is why
/// this needs no server round-trip and carries none of the risk of a
/// custom-built lock.
class AppLock {
  static final _auth = LocalAuthentication();

  /// Whether this device has any form of lock configured (biometric, PIN,
  /// pattern, or password) — the Settings toggle only appears when true,
  /// since there's nothing to authenticate against otherwise.
  static Future<bool> isSupported() async {
    try {
      return await _auth.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  /// Prompts the device lock screen. True only on a real, successful
  /// authentication.
  static Future<bool> authenticate() async {
    try {
      return await _auth.authenticate(
        localizedReason: 'Unlock KYNOX WMS',
        options: const AuthenticationOptions(biometricOnly: false, stickyAuth: true),
      );
    } catch (_) {
      return false;
    }
  }
}
