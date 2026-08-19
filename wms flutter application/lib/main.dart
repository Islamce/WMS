import 'package:flutter/material.dart';

import 'core/push.dart';
import 'core/session.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

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

class _Root extends StatelessWidget {
  const _Root();
  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    if (session.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return session.isAuthenticated ? const HomeScreen() : const LoginScreen();
  }
}
