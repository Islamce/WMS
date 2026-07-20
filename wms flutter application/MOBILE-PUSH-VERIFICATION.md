# Android Push Notification — Device Verification Checklist

The WMS mobile app renders **every** push as an Android system-tray notification
using a **data-only FCM payload + `flutter_local_notifications`** (channel
`wms_notifications`, High importance). FCM never auto-displays, so there is
exactly one notification per message in every app state.

Automated widget tests can't exercise real FCM delivery (it needs Google Play
Services + a physical device), so validate on a **real Android device** with a
release APK built by the `GOOGLE_SERVICES_JSON`-injected CI job.

## Preconditions
- Server has `FIREBASE_SERVICE_ACCOUNT_JSON` (or `_PATH`) set and was restarted.
- APK installed from the CI build that had the `GOOGLE_SERVICES_JSON` secret.
- Signed in on the device (this registers the FCM token with the backend).

Trigger each test with the admin validation endpoint:
`POST /api/debug/push-test` (expect `success:true, attemptedPush:true`).

## Test matrix

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | **App open (foreground)** | App on screen → fire push | Tray notification appears; `[push] foreground message received` + `notification displayed` in logs |
| 2 | **App minimized (background)** | Press Home, app in background → fire push | Tray notification appears; `[push] background message received` + `notification displayed` |
| 3 | **Removed from recents (terminated)** | Swipe app out of recents → fire push | Tray notification appears (may take a few seconds on battery-optimised OEMs) |
| 4 | **Screen locked** | Lock the device → fire push | Notification shows on the lock screen |
| 5 | **Notification tap** | Tap any of the above | App opens; if the payload carries `route=request&requestId=N`, the request detail screen opens |
| 6 | **Permission denied** | Deny the POST_NOTIFICATIONS prompt (or revoke in Settings) → fire push | No tray notification (expected); the in-app inbox bell still updates. Re-granting restores tray delivery |
| 7 | **Token refresh** | Clear app storage / reinstall, sign in again | `[push] token generated (len=…)` logged, device re-registered; a subsequent push arrives |

## Reading logs
`adb logcat | grep "\[push\]"` — structured lines only; the full FCM token is
never logged (only its length), and payload contents are not dumped.

Expected log line types: token generated/refreshed, foreground message received,
background message received, notification displayed, notification opened.

## Known limitation
Aggressive OEM battery optimisation (Xiaomi/Huawei/etc.) can delay data-message
delivery to a **terminated** app. `android.priority: 'high'` is set to minimise
this; if a specific fleet device is affected, exclude the app from battery
optimisation in Android Settings.
