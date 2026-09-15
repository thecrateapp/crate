# iOS build and Google Cast

## Dependency strategy

Capacitor remains integrated through Swift Package Manager. Google does not
publish the Cast iOS Sender SDK through SPM; its supported integrations are
CocoaPods or a manually embedded XCFramework. Crate uses the official
`google-cast-sdk` CocoaPod pinned to 4.8.4 and commits `Podfile.lock`.

After changing iOS dependencies:

```bash
cd app/listen/ios/App
pod install
open App.xcworkspace
```

Use `App.xcworkspace`, not `App.xcodeproj`, for Cast-enabled builds. This
follows the [Google Cast iOS setup
guide](https://developers.google.com/cast/docs/ios_sender).

## Availability behavior

`CrateCastPlugin` is compiled with `canImport(GoogleCast)`. A development
project build without installed pods remains buildable, but reports
`visible=false`; Listen hides Cast instead of exposing a control that can only
fail. The CocoaPods workspace compiles the real sender and enables discovery,
session creation and playback control.

`Info.plist` declares `_googlecast._tcp` and a local-network usage description.
Cast discovery and receiver playback still require validation on a physical
iPhone and receiver; the simulator build is a compile/link regression gate,
not a substitute.

## Receiver application ID and native contract

The native sender reads `CrateCastReceiverApplicationID` from `Info.plist`.
Xcode expands it from `CRATE_CAST_RECEIVER_APP_ID`; local debug builds default
to Google's Default Media Receiver, while release automation must inject the
registered 8-character Crate receiver ID. It must match the
`VITE_CAST_RECEIVER_APP_ID` compiled into the Listen web bundle and the API
receiver configuration.

The Capacitor bridge loads the complete receiver-owned queue, preserves Crate
stable item IDs in media `customData`, and exposes queue mutation, navigation,
playback-state and versioned protocol events. Disconnect leaves the receiver
running; Stop Cast stops playback and ends the receiver session. Reconnection
restores the scoped session metadata from the current queue item without
putting bearer credentials in Cast payloads.

To prove build-setting expansion locally:

```bash
xcodebuild -workspace App.xcworkspace -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  CRATE_CAST_RECEIVER_APP_ID=ABCD1234 build
```

## CI and versioning

`.github/workflows/build-ios.yml`:

- tests the TypeScript Cast, MediaSession, secure-store and callback contracts;
- executes an isolated Keychain set/get/list/remove contract using the same
  `CrateSecureSessionStore` compiled into the app;
- builds and syncs the local Capacitor bundle;
- installs the locked CocoaPods graph;
- builds `App.xcworkspace` for a generic iOS simulator with signing disabled;
- maps the stable `MAJOR.MINOR.PATCH` portion of a tag to
  `MARKETING_VERSION`, using the run number for `CURRENT_PROJECT_VERSION`.

Distribution archive/signing stays in the protected release environment and
must use Apple credentials stored as GitHub secrets. No Apple credential or
provisioning profile belongs in the repository.
