import 'package:flutter/material.dart';

import '../main.dart';
import '../widgets/common.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late TextEditingController _server;

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(text: SessionScope.of(context).baseUrl);
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          SectionCard(
            title: 'Server',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _server,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Server URL', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 10),
                FilledButton(
                  onPressed: () async {
                    await session.setBaseUrl(_server.text);
                    if (context.mounted) showSnack(context, 'Server URL saved.');
                  },
                  child: const Text('Save'),
                ),
              ],
            ),
          ),
          SectionCard(
            title: 'Account',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Name: ${session.userName}'),
                Text('Role: ${session.userRole}'),
                const SizedBox(height: 6),
                Text('Permissions (${session.permissions.length}):',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 6, runSpacing: 6,
                  children: session.permissions
                      .map((p) => Chip(label: Text(p, style: const TextStyle(fontSize: 11)),
                          visualDensity: VisualDensity.compact))
                      .toList(),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                  onPressed: () {
                    session.signOut();
                    Navigator.of(context).pop();
                  },
                ),
              ],
            ),
          ),
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('WMS Mobile v1.0.0 · connects to the same REST API and database as the web app.',
                textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Colors.grey)),
          ),
        ],
      ),
    );
  }
}
