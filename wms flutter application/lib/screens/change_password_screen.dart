import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../main.dart';
import '../widgets/common.dart';

/// Change the signed-in user's own password. PATCH /api/auth/password.
///
/// When [forced] is true (must_change_password on a temp/reset account —
/// mirrors the web app's forced-change gate) there is no back/skip: the
/// screen is the entire app until a real password is set.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key, this.forced = false});
  final bool forced;

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_next.text != _confirm.text) {
      showSnack(context, 'New passwords do not match.', error: true);
      return;
    }
    if (_next.text.length < 8 || !RegExp(r'[A-Za-z]').hasMatch(_next.text) || !RegExp(r'[0-9]').hasMatch(_next.text)) {
      showSnack(context, 'Password must be at least 8 characters and contain a letter and a number.', error: true);
      return;
    }
    final session = SessionScope.of(context);
    setState(() => _busy = true);
    try {
      await session.api.patch('/api/auth/password', {
        'current_password': _current.text,
        'new_password': _next.text,
      });
      session.clearMustChangePassword();
      if (mounted) {
        showSnack(context, 'Password changed.');
        if (!widget.forced) Navigator.of(context).pop();
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.forced) ...[
              const Icon(Icons.lock_reset, size: 48, color: Color(0xFF31c3c9)),
              const SizedBox(height: 12),
              const Text('You must set a new password before continuing.',
                  textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 24),
            ],
            TextField(
              controller: _current,
              obscureText: _obscure,
              decoration: const InputDecoration(
                  labelText: 'Current password', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _next,
              obscureText: _obscure,
              decoration: const InputDecoration(
                labelText: 'New password',
                helperText: 'At least 8 characters, with a letter and a number.',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _confirm,
              obscureText: _obscure,
              onSubmitted: (_) => _busy ? null : _submit(),
              decoration: InputDecoration(
                labelText: 'Confirm new password',
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy ? null : _submit,
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              child: _busy
                  ? const SizedBox(height: 20, width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Change password'),
            ),
          ],
        ),
      ),
    );
    if (widget.forced) {
      return PopScope(canPop: false, child: Scaffold(body: Center(child: body)));
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Change Password')),
      body: Center(child: body),
    );
  }
}
