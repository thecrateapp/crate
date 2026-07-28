# Listen native authentication contract

## Scope

Android and iOS use a two-stage OAuth exchange. Provider credentials remain
server-side and Crate access/refresh tokens are returned only by an
authenticated HTTPS response from the configured Crate API. Web and Tauri
retain their existing callback contracts.

## Start

`POST /api/auth/oauth/{google|apple}/start`

Native requests must send `X-Crate-App: listen-android` or
`X-Crate-App: listen-ios` and:

```json
{
  "return_to": "cratemusic://oauth/callback",
  "native_code_challenge": "<base64url SHA-256 challenge>",
  "native_state": "<random base64url state>",
  "invite_token": null
}
```

The native callback is exact. Other custom-scheme hosts or paths and arbitrary
HTTPS callback hosts are rejected. The provider-facing PKCE verifier generated
by the backend is separate from this app-to-Crate handoff verifier.

## Callback

After provider identity resolution, Crate redirects to:

```text
cratemusic://oauth/callback?code=<opaque-one-time-code>&state=<native-state>
```

The URL must never contain `token`, `refresh_token`, `access_expires_at`,
`next`, a verifier, or an invite token. The code expires after 60 seconds. Its
Redis record is addressed by `sha256(code)` and contains only the user id,
native app id, state, challenge and expiry.

## Exchange

`POST /api/auth/native/exchange`

```json
{
  "code": "<opaque-one-time-code>",
  "code_verifier": "<original app verifier>",
  "state": "<native-state>"
}
```

Redis `GETDEL` atomically consumes the handoff before validating its bindings,
so retries, concurrent exchanges, wrong-state attempts and wrong-verifier
attempts cannot create more than one session. A successful exchange returns
the standard `AuthLoginResponse` over HTTPS. Production fails closed if Redis
is unavailable; only explicit local development may use the bounded in-memory
store.

## Device storage

Capacitor stores `crate.session.<server-id>` in Android Keystore-backed
AES-GCM storage or iOS Keychain with
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Transient OAuth records use
`crate.oauth.<state>`. Public server metadata in `localStorage` contains only
id, label, URL and access-token expiry.

Migration copies and reads back each legacy secret before rewriting public
metadata. Any secure-store failure leaves the legacy record untouched and
blocks authentication bootstrap with a recoverable restart screen.

## Rollout and compatibility

- `NATIVE_OAUTH_EXCHANGE_ENABLED` enables the new start/callback/exchange path.
- `NATIVE_OAUTH_LEGACY_REDIRECT_ENABLED` keeps released clients working during
  migration and defaults to enabled.
- Deploy the backend and verify Redis first, enable exchange on a test node,
  then publish the native client.
- Roll back an exchange incident by disabling
  `NATIVE_OAUTH_EXCHANGE_ENABLED`. Existing sessions and secure-store records
  remain valid; do not roll back the database or reintroduce credentials in
  redirects.
- Disable credential redirects only after supported native versions sustain at
  least 95% exchange adoption for 30 days and no beta rollback is active.

Legacy callback parsing remains in the client during that window, but it
accepts only the exact `cratemusic://oauth/callback` URL.

## Errors and redaction

- `400`: malformed client, callback, state, challenge or verifier.
- `401`: expired, consumed or incorrectly bound handoff.
- `426`: legacy native client rejected after the compatibility window.
- `503`: exchange disabled or Redis unavailable.

Logs and telemetry must not contain state, verifier, handoff code, callback
URL, access token or refresh token. Allowed aggregate events are
`native_oauth_started`, `native_oauth_exchange_success` and
`native_oauth_exchange_failure` with a bounded failure class.
