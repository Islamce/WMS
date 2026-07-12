# WMS Mobile (Flutter)

A native Android/iOS companion app for the WMS platform. It talks to the **same
REST API and database** as the web app — no separate backend — so anything done
on the phone shows up on the web and vice-versa.

## What it does

Screens are permission-gated exactly like the web app (the signed-in user's
permissions decide which menu items appear):

| Area | Screen | Permission |
|------|--------|------------|
| General | Dashboard (live KPIs, recent movements, top stock) | `dashboard` |
| General | AI Stock Analytics (classification, reorder, insights) | `ai_analytics` |
| General | Notifications (mark read / read-all) | `notifications` |
| Requests | Create Request (material search, dropdowns, stock note) | `create_request` |
| Requests | Requests list + detail (submit / cancel) | `material_requests` |
| Requests | Approvals (approve / reject / return) | `approvals` |
| Warehouse | My Picking Tasks (accept → start → QR scan → confirm → complete) | `picking` |
| Warehouse | Goods Issue Posting (post GI / return to picker) | `gi_posting` |

Segregation of duties, shortage-reason prompts, FIFO/FEFO allocations and every
workflow guard are enforced by the shared backend, so the mobile app inherits
them automatically.

## Connecting to the backend

The app has **no hard-coded server**. On the login screen tap **Server
settings** and enter the URL of a running WMS backend:

- **Android emulator** → `http://10.0.2.2:3000` (the host machine's `localhost`).
- **Real phone on the same Wi-Fi** → `http://<your-PC-LAN-IP>:3000`
  (e.g. `http://192.168.1.20:3000`). Start the backend with `npm start`.
- **GitHub Codespaces / any public deploy** → the public `https://…` URL
  (make the forwarded port **Public**).

The URL is saved on the device; the token is validated against `/api/auth/me`
on every launch so permissions stay fresh and a disabled account is locked out
immediately.

Default admin: `admin@example.com` / `Admin@123456`.

## Build the APK yourself

Requires the Flutter SDK (3.9+) and the Android SDK.

```bash
cd "wms flutter application"
flutter pub get
flutter build apk --release                 # single fat APK
flutter build apk --release --split-per-abi  # smaller per-ABI APKs
```

Output: `build/app/outputs/flutter-apk/`. The `arm64-v8a` APK covers virtually
all modern phones. To install, copy the APK to the phone and open it (enable
"install from unknown sources").

CI also builds the APKs on every push — see
`.github/workflows/flutter-apk.yml`; download them from the workflow run's
**Artifacts**.

## Before the Play Store

The debug build is signed with Flutter's debug key — fine for sideloading, not
for publishing. To release:

1. Create an upload keystore and a `key.properties`, and add a `signingConfigs`
   block to `android/app/build.gradle.kts`
   (see <https://docs.flutter.dev/deployment/android#signing-the-app>).
2. `flutter build appbundle --release` to produce the `.aab` for Play Console.
3. Bump `version:` in `pubspec.yaml` for each release.

## Project layout

```
lib/
├── main.dart                 # app + SessionScope (InheritedNotifier) + theming
├── core/
│   ├── api_client.dart       # JSON HTTP wrapper (bearer token, error mapping)
│   ├── session.dart          # server URL + token + user/permissions (persisted)
│   └── format.dart           # qty/date formatting + status colours
├── widgets/common.dart       # AsyncView (load/error/retry/refresh), StatusChip…
└── screens/                  # one file per screen (see table above)
```
