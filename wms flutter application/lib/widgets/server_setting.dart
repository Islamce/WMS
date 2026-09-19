import 'package:flutter/material.dart';

import '../core/server_url.dart';
import '../core/session.dart';
import '../main.dart';
import 'common.dart';

/// Loud, permanent strip shown whenever the app is pointed anywhere other than
/// production. It is not dismissible on purpose: the failure this guards
/// against is somebody finishing a UAT session, handing the phone back, and
/// nobody noticing for a week that the stock they are posting goes nowhere
/// real — or, in the other direction, a tester who believes they are on a test
/// server reversing a goods issue on the live one.
class ServerBanner extends StatelessWidget {
  const ServerBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    if (session.isDefaultServer) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      color: const Color(0xFFe34948),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: [
          const Icon(Icons.warning_amber_rounded, size: 16, color: Colors.white),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'TEST SERVER — ${session.serverHost}. This is not the live warehouse.',
              style: const TextStyle(
                  color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// Opens the server editor. Returns true when the server actually changed, so
/// a caller can tell the user what that just cost them (they are now signed
/// out). Shared by the login screen and Settings: the login screen needs it
/// because a wrong address otherwise locks somebody out of the only screen
/// where they could fix it.
Future<bool> showServerDialog(BuildContext context, Session session) async {
  final controller = TextEditingController(text: session.baseUrl);
  String? error;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: const Text('Server'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Only change this to run a test against a test warehouse. '
              'Switching signs you out and discards anything still waiting to sync, '
              'because it belongs to the server you are leaving.',
              style: TextStyle(fontSize: 12),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autocorrect: false,
              keyboardType: TextInputType.url,
              decoration: InputDecoration(
                labelText: 'Server address',
                hintText: ServerUrl.defaultUrl,
                errorText: error,
                border: const OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          // Keyed off the session, not the text field: the field changes as
          // the user types without rebuilding this list, so a condition on it
          // would make the button flicker in and out a keystroke late.
          if (!session.isDefaultServer)
            TextButton(
              onPressed: () {
                controller.text = ServerUrl.defaultUrl;
                setDialogState(() => error = null);
              },
              child: const Text('Use production'),
            ),
          FilledButton(
            onPressed: () {
              final problem = ServerUrl.validationError(controller.text);
              if (problem != null) {
                setDialogState(() => error = problem);
                return;
              }
              Navigator.pop(context, true);
            },
            child: const Text('Switch'),
          ),
        ],
      ),
    ),
  );
  if (confirmed != true) return false;

  final target = controller.text;
  if (ServerUrl.normalize(target) == session.baseUrl) return false;
  try {
    await session.setBaseUrl(target);
  } on ArgumentError catch (e) {
    if (context.mounted) showSnack(context, '${e.message}', error: true);
    return false;
  }
  if (context.mounted) {
    showSnack(context,
        'Now using ${session.serverHost}. Sign in again to continue.');
  }
  return true;
}
