import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/app_lock.dart';
import '../core/i18n.dart';
import '../main.dart';
import '../widgets/common.dart';
import 'change_password_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
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
                const SizedBox(height: 14),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(t('Push notifications')),
                  subtitle: Text(t('Alerts for requests, approvals, picking and deliveries.'),
                      style: const TextStyle(fontSize: 12)),
                  value: session.pushEnabled,
                  onChanged: (v) => session.setPushEnabled(v),
                ),
              ],
            ),
          ),
          SectionCard(
            title: t('Sync'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Icon(session.online ? Icons.cloud_done_outlined : Icons.cloud_off,
                      color: session.online ? const Color(0xFF1baf7a) : const Color(0xFFeda100), size: 20),
                  const SizedBox(width: 8),
                  Text(session.online ? t('Online') : t('Offline')),
                ]),
                const SizedBox(height: 6),
                Text('${t('Pending records to sync')}: ${session.queue.pending.length}'),
                if (session.queue.errors.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text('${t('Could not sync')} (${session.queue.errors.length}):',
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFFe34948))),
                  ...session.queue.errors.map((e) => Text('• $e',
                      style: const TextStyle(fontSize: 12, color: Color(0xFFe34948)))),
                  TextButton(
                    onPressed: () async { await session.queue.clearErrors(); },
                    child: Text(t('Dismiss')),
                  ),
                ],
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  icon: const Icon(Icons.sync),
                  label: Text(t('Sync now')),
                  onPressed: session.queue.pending.isEmpty ? null : () => session.flushQueue(),
                ),
              ],
            ),
          ),
          FutureBuilder<bool>(
            future: AppLock.isSupported(),
            builder: (context, snap) {
              if (snap.data != true) return const SizedBox.shrink();
              return SectionCard(
                title: t('Security'),
                child: SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(t('Require device lock')),
                  subtitle: Text(
                      t('Use this device\'s biometric or PIN/pattern lock to reopen the app.'),
                      style: const TextStyle(fontSize: 12)),
                  value: session.appLockEnabled,
                  onChanged: (v) => session.setAppLockEnabled(v),
                ),
              );
            },
          ),
          SectionCard(
            title: t('Account'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${t('Name')}: ${session.userName}'),
                Text('${t('Role')}: ${session.userRole}'),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  icon: const Icon(Icons.password_outlined),
                  label: Text(t('Change Password')),
                  onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const ChangePasswordScreen())),
                ),
                const SizedBox(height: 8),
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
          if (session.userRole == 'admin')
            SectionCard(
              title: t('Authority'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
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
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: FutureBuilder<PackageInfo>(
              future: PackageInfo.fromPlatform(),
              builder: (context, snap) {
                final version = snap.hasData
                    ? 'v${snap.data!.version} (${snap.data!.buildNumber})'
                    : '';
                return Text(
                  'KYNOX WMS $version · connects to the same REST API and database as the web app.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 11, color: Colors.grey),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
