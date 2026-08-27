import 'package:flutter/material.dart';

import '../core/app_lock.dart';
import '../main.dart';

/// Shown instead of the app whenever [Session.locked] is true (device-lock
/// enabled in Settings and the app was just opened or brought back from the
/// background). Delegates entirely to the device's own biometric/PIN/pattern
/// prompt — there is no in-app credential to get wrong.
class AppLockScreen extends StatefulWidget {
  const AppLockScreen({super.key});
  @override
  State<AppLockScreen> createState() => _AppLockScreenState();
}

class _AppLockScreenState extends State<AppLockScreen> with WidgetsBindingObserver {
  bool _busy = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _tryUnlock());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _tryUnlock();
  }

  Future<void> _tryUnlock() async {
    if (_busy) return;
    setState(() { _busy = true; _failed = false; });
    final ok = await AppLock.authenticate();
    if (!mounted) return;
    setState(() { _busy = false; _failed = !ok; });
    if (ok) SessionScope.of(context).unlock();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.lock_outline, size: 56, color: Color(0xFF31c3c9)),
                const SizedBox(height: 16),
                const Text('KYNOX WMS is locked',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                if (_failed) ...[
                  const SizedBox(height: 8),
                  const Text('Authentication required to continue.',
                      textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
                ],
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: _busy ? null : _tryUnlock,
                  icon: const Icon(Icons.fingerprint),
                  label: Text(_busy ? 'Checking…' : 'Unlock'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
