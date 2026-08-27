import 'package:flutter/material.dart';

import 'core/push.dart';
import 'core/session.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/change_password_screen.dart';
import 'screens/app_lock_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session();
  runApp(WmsApp(session: session));
  session.load();
}

/// Makes the [Session] available to the whole tree and rebuilds on changes.
class SessionScope extends InheritedNotifier<Session> {
  const SessionScope({super.key, required Session session, required super.child})
      : super(notifier: session);

  static Session of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<SessionScope>();
    assert(scope != null, 'No SessionScope found in context');
    return scope!.notifier!;
  }
}

class WmsApp extends StatelessWidget {
  const WmsApp({super.key, required this.session});
  final Session session;

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF31c3c9); // KYNOX brand teal (matches web public/css/kynox-v2.css --primary)
    return SessionScope(
      session: session,
      // Rebuild MaterialApp when the session's theme/language change, so the
      // settings take effect instantly (Arabic also flips the app to RTL).
      child: ListenableBuilder(
        listenable: session,
        builder: (context, _) => MaterialApp(
          title: 'KYNOX WMS',
          debugShowCheckedModeBanner: false,
          // Lets a push-notification tap navigate (e.g. open a request).
          navigatorKey: Push.navigatorKey,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(seedColor: seed),
            useMaterial3: true,
            appBarTheme: const AppBarTheme(centerTitle: false),
          ),
          darkTheme: ThemeData(
            colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark),
            useMaterial3: true,
          ),
          themeMode: session.themeMode,
          builder: (context, child) => Directionality(
            textDirection: session.lang == 'ar' ? TextDirection.rtl : TextDirection.ltr,
            child: child ?? const SizedBox.shrink(),
          ),
          home: const _Root(),
        ),
      ),
    );
  }
}

class _Root extends StatefulWidget {
  const _Root();
  @override
  State<_Root> createState() => _RootState();
}

class _RootState extends State<_Root> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // paused/hidden = backgrounded; re-lock (a no-op if the lock isn't
    // enabled or nothing is signed in) so returning to the app re-prompts.
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      SessionScope.of(context).lockIfEnabled();
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    if (session.loading) {
      return const _SplashScreen();
    }
    if (!session.isAuthenticated) return const LoginScreen();
    if (session.mustChangePassword) return const ChangePasswordScreen(forced: true);
    if (session.locked) return const AppLockScreen();
    return const HomeScreen();
  }
}

/// Animated KYNOX launch screen shown while the session is being restored
/// from disk (token check, saved server URL, etc). Logo fades and scales in,
/// then a thin progress indicator appears once the entrance animation
/// settles, so a slow session load still gives the user feedback.
class _SplashScreen extends StatefulWidget {
  const _SplashScreen();
  @override
  State<_SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<_SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..forward();
  late final Animation<double> _scale = CurvedAnimation(parent: _controller, curve: Curves.easeOutBack);
  late final Animation<double> _fade = CurvedAnimation(
    parent: _controller,
    curve: const Interval(0.0, 0.6, curve: Curves.easeOut),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07111f),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ScaleTransition(
              scale: _scale,
              child: FadeTransition(
                opacity: _fade,
                child: Image.asset('assets/brand/kynox_mark.png', width: 96, height: 96),
              ),
            ),
            const SizedBox(height: 20),
            FadeTransition(
              opacity: _fade,
              child: const Text('KYNOX WMS',
                  style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            ),
            const SizedBox(height: 28),
            AnimatedBuilder(
              animation: _controller,
              builder: (context, child) => Opacity(
                opacity: _controller.isCompleted ? 1 : 0,
                child: const SizedBox(
                  width: 28, height: 28,
                  child: CircularProgressIndicator(strokeWidth: 2.4, color: Color(0xFF31c3c9)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
