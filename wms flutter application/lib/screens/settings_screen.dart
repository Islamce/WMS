import 'package:flutter/material.dart';

import '../core/i18n.dart';
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
      appBar: AppBar(title: Text(t('Settings'))),
      body: ListView(
        children: [
          SectionCard(
            title: t('Appearance'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: session.lang,
                  decoration: InputDecoration(
                      labelText: t('Language'), border: const OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(value: 'en', child: Text('English')),
                    DropdownMenuItem(value: 'ar', child: Text('العربية')),
                    DropdownMenuItem(value: 'fr', child: Text('Français')),
                  ],
                  onChanged: (v) { if (v != null) session.setLang(v); },
                ),
                const SizedBox(height: 14),
                Text(t('Theme'), style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                SegmentedButton<ThemeMode>(
                  segments: [
                    ButtonSegment(value: ThemeMode.system,
                        icon: const Icon(Icons.settings_suggest_outlined), label: Text(t('System'))),
                    ButtonSegment(value: ThemeMode.light,
                        icon: const Icon(Icons.light_mode_outlined), label: Text(t('Light'))),
                    ButtonSegment(value: ThemeMode.dark,
                        icon: const Icon(Icons.dark_mode_outlined), label: Text(t('Dark'))),
                  ],
                  selected: {session.themeMode},
                  onSelectionChanged: (s) => session.setThemeMode(s.first),
                ),
              ],
            ),
          ),
          SectionCard(
            title: t('Server'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _server,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: InputDecoration(
                    labelText: t('Server URL'), border: const OutlineInputBorder()),
                ),
                const SizedBox(height: 10),
                FilledButton(
                  onPressed: () async {
                    await session.setBaseUrl(_server.text);
                    if (context.mounted) showSnack(context, t('Server URL saved.'));
                  },
                  child: Text(t('Save')),
                ),
              ],
            ),
          ),
          SectionCard(
            title: t('Account'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${t('Name')}: ${session.userName}'),
                Text('${t('Role')}: ${session.userRole}'),
                const SizedBox(height: 6),
                Text('${t('Permissions')} (${session.permissions.length}):',
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
                  label: Text(t('Sign out')),
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
