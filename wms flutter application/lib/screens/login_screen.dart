import 'package:flutter/material.dart';

import '../main.dart';
import '../widgets/common.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController(text: 'admin@example.com');
  final _password = TextEditingController();
  late TextEditingController _server;
  bool _busy = false;
  bool _showServer = false;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(text: SessionScope.of(context).baseUrl);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _server.text = SessionScope.of(context).baseUrl;
  }

  Future<void> _login() async {
    final session = SessionScope.of(context);
    setState(() => _busy = true);
    try {
      await session.setBaseUrl(_server.text);
      await session.signIn(_email.text, _password.text);
      // _Root rebuilds via the notifier and shows HomeScreen.
    } catch (e) {
      if (mounted) showSnack(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.warehouse, size: 64, color: Color(0xFF2a78d6)),
                const SizedBox(height: 12),
                Text('WMS Mobile',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                const Text('Warehouse Management System',
                    textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 28),
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Email', prefixIcon: Icon(Icons.person_outline),
                    border: OutlineInputBorder()),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _password,
                  obscureText: _obscure,
                  onSubmitted: (_) => _busy ? null : _login(),
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: const Icon(Icons.lock_outline),
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    icon: Icon(_showServer ? Icons.expand_less : Icons.dns_outlined, size: 18),
                    label: const Text('Server settings'),
                    onPressed: () => setState(() => _showServer = !_showServer),
                  ),
                ),
                if (_showServer) ...[
                  TextField(
                    controller: _server,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'Server URL',
                      helperText: 'e.g. https://<codespace>-3000.app.github.dev',
                      prefixIcon: Icon(Icons.link),
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Android emulator → http://10.0.2.2:3000 · real device → your PC LAN IP or a public URL.',
                    style: TextStyle(fontSize: 11, color: Colors.grey),
                  ),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _login,
                  style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16)),
                  child: _busy
                      ? const SizedBox(height: 20, width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Sign in'),
                ),
                const SizedBox(height: 12),
                const Text('Default admin: admin@example.com / Admin@123456',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, color: Colors.grey)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
