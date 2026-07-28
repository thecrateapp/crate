# Android release signing

Android tag builds publish a signed, minified APK and AAB. Manual workflow
dispatches remain debug-only and cannot overwrite `crate.apk`.

The signed release APK is directly installable outside Google Play. Android
requires the user to allow “Install unknown apps” for the browser or file
manager opening it. The AAB is store-only and cannot be installed directly.

Debug and release builds use different signing identities. A device with a
debug build must uninstall it once before installing the production-signed
release APK; after that, later sideloaded releases signed by the same stable
keystore upgrade in place without losing application data.

## Required GitHub secrets

| Secret                              | Value                              |
| ----------------------------------- | ---------------------------------- |
| `ANDROID_SIGNING_KEYSTORE_BASE64`   | Base64-encoded JKS/PKCS12 keystore |
| `ANDROID_SIGNING_KEYSTORE_PASSWORD` | Keystore password                  |
| `ANDROID_SIGNING_KEY_ALIAS`         | Release key alias                  |
| `ANDROID_SIGNING_KEY_PASSWORD`      | Private-key password               |

The workflow decodes the keystore into `$RUNNER_TEMP` and never places it in
the repository or an uploaded artifact. A tag build fails before Gradle when a
secret is absent. Gradle independently fails every release task if its signing
or version environment is incomplete.

## Release identity

Every production APK and AAB must use the `crate-release` key and match this
certificate fingerprint:

```text
SHA-256 1B:7D:FC:3D:57:29:ED:2F:45:E6:F3:6A:3F:CB:73:4F:B1:E4:59:FF:12:1A:D6:3E:84:21:80:0E:BF:25:D4:6D
```

Verify the fingerprint before publishing or installing a release candidate.
The keystore needs an encrypted backup outside both the repository and GitHub;
repository secrets cannot be read back and are not a recoverable backup.

## Version mapping

`scripts/android-release-version.mjs` derives `versionName` and a monotonic
`versionCode` from tags shaped as:

```text
vMAJOR.MINOR.PATCH
vMAJOR.MINOR.PATCH-alpha[.N]
vMAJOR.MINOR.PATCH-beta[.N]
vMAJOR.MINOR.PATCH-rc[.N]
```

For the same semantic version, alpha sorts before beta, beta before release
candidate and release candidate before stable. Invalid or overflowing tags
fail closed.

## Local signed build

```bash
export CRATE_ANDROID_KEYSTORE_FILE=/absolute/path/to/release.jks
export CRATE_ANDROID_KEYSTORE_PASSWORD='...'
export CRATE_ANDROID_KEY_ALIAS='...'
export CRATE_ANDROID_KEY_PASSWORD='...'
make cap-android-release CAP_ANDROID_RELEASE_TAG=v2.4.0-beta
```

Artifacts are copied to `artifacts/capacitor/android/`. Never commit the
keystore, passwords, generated APK/AAB, R8 mapping or native symbols.

Before publishing, install the signed APK on a physical device and validate
OAuth callback, secure session migration, Home/Collection data, artwork,
Media3 playback, lock-screen/Bluetooth controls, offline playback, Cast and
sharing.
