import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing. The key comes from android/key.properties (git-ignored) or,
// on CI, from WMS_KEYSTORE_* environment variables written from secrets. With
// neither present the build still succeeds on the DEBUG key, but says so out
// loud: a debug-signed "release" gets a fresh key on every CI runner, so each
// update refuses to install over the last and the uninstall discards any
// unsynced offline queue. It also cannot be distributed through Play or an MDM.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}
fun signingValue(propKey: String, envKey: String): String? =
    keystoreProperties.getProperty(propKey) ?: System.getenv(envKey)
val releaseStoreFile = signingValue("storeFile", "WMS_KEYSTORE_PATH")
val releaseStorePassword = signingValue("storePassword", "WMS_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "WMS_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "WMS_KEY_PASSWORD")
val hasReleaseSigning = listOf(releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword)
    .all { !it.isNullOrBlank() }

android {
    namespace = "com.wms.wms_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // Required by flutter_local_notifications (v10+): desugaring back-ports
        // the java.time APIs it uses so notifications work on older Android too.
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.wms.wms_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                logger.warn("WARNING: no release keystore (android/key.properties or WMS_KEYSTORE_* env). " +
                    "Signing this release with the DEBUG key - it cannot be updated in place or distributed through Play.")
                signingConfig = signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // Core-library desugaring runtime — required by flutter_local_notifications.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

// Real push notifications (Firebase Cloud Messaging) activate only once the
// operator drops their own Firebase project's google-services.json here —
// see DEPLOY-HOSTINGER.md. Without it, this build (and CI) is unaffected:
// the app falls back to the in-app notification inbox only.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
