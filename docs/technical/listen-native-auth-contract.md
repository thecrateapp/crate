# Listen native authentication contract

## Scope

Android, iOS, Tauri and Crate Decks use the same two-stage OAuth exchange (Decks
differences are in [Native clients](#native-clients-listen-and-crate-decks)). Provider credentials remain
server-side and Crate access/refresh tokens are returned only by an
HTTPS response from the exact configured Crate API that started the flow. Web
retains its browser callback contract.

## Start

`POST /api/auth/oauth/{google|apple}/start`

Native requests must send `X-Crate-App: listen-android`, `listen-ios` or
`listen-tauri` and:

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
`crate.oauth.<state>`. Tauri currently stores its per-server session and
transient OAuth record in desktop WebView storage until its native secret-store
migration. Public Capacitor server metadata in `localStorage` contains only id,
label, URL and access-token expiry.

Migration copies and reads back each legacy secret before rewriting public
metadata. Any secure-store failure leaves the legacy record untouched and
blocks authentication bootstrap with a recoverable restart screen.

## Rollout and compatibility

- `NATIVE_OAUTH_EXCHANGE_ENABLED` defaults to enabled and controls the secure
  start/callback/exchange path.
- Deploy the backend and verify Redis before publishing a native client that
  depends on this contract.
- Roll back an exchange incident by disabling
  `NATIVE_OAUTH_EXCHANGE_ENABLED`. Existing sessions and secure-store records
  remain valid; do not roll back the database or reintroduce credentials in
  redirects. Native credential redirects cannot be enabled at runtime.

## Errors and redaction

- `400`: malformed client, callback, state, challenge or verifier.
- `401`: expired, consumed or incorrectly bound handoff.
- `426`: legacy native client rejected after the compatibility window.
- `503`: exchange disabled or Redis unavailable.

Logs and telemetry must not contain state, verifier, handoff code, callback
URL, access token or refresh token. Allowed aggregate events are
`native_oauth_started`, `native_oauth_exchange_success` and
`native_oauth_exchange_failure` with a bounded failure class.

## Native clients: Listen and Crate Decks

Crate Decks (the desktop DJ client) is a native client with the same session
policy as Listen. Source: `app/crate/api/auth.py` (`_is_refresh_capable_client`,
`_is_decks_client`) and `app/crate/api/native_oauth_auth.py`.

|                        | Listen                                                                        | Crate Decks                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `X-Crate-App`          | `listen-web`, `listen-android`, `listen-ios`, `listen-native`, `listen-tauri` | `decks/<version>` (`[0-9a-z][0-9a-z.+-]{0,63}`, case-insensitive) or `crate-decks` |
| Native OAuth app ID    | the header value                                                              | `crate-decks`, whatever the version in the header                                  |
| Native callback        | `cratemusic://oauth/callback` (Tauri: HTTPS completion page)                  | `http://127.0.0.1:<port>/callback` (RFC 8252 loopback)                             |
| PKCE and state         | Required (`426` for legacy clients without them)                              | Always required (`400` without them)                                               |
| Refresh token          | Yes                                                                           | Yes                                                                                |
| Access token / session | 1 h / 30 days                                                                 | 1 h / 30 days                                                                      |
| Auth cookies           | Listen cookie names                                                           | None: tokens travel only in the JSON body                                          |
| Device fingerprint     | `X-Device-Fingerprint`, or derived from the headers                           | `X-Device-Fingerprint` only, never derived                                         |

Rules for Decks:

- `POST /api/auth/login`, `/api/auth/register` and `/api/auth/native/exchange`
  return `refresh_token`; `POST /api/auth/refresh` returns a new access token
  and a new refresh token for the same session, as for Listen. Refresh tokens
  are not single-use: an earlier one stays valid until the session expires or
  is revoked.
- The loopback callback must match exactly: scheme `http`, host `127.0.0.1`,
  an explicit port from 1 to 65535 without leading zeros, path `/callback`, and
  no user info, query or fragment. `localhost`, `[::1]`, other hosts, HTTPS and
  custom schemes are rejected with `400`. The provider callback itself stays on
  the registered Listen origin; Crate then redirects the browser to
  `http://127.0.0.1:<port>/callback?code=<code>&state=<state>` (or
  `?state=<state>&error=cancelled|provider_error`).
- Only `mode=login` is supported. Account linking (`native_link`) stays
  Tauri-only.
- The handoff is bound to `crate-decks`, so the exchange accepts any
  `decks/<version>` header (or `crate-decks`). Exchanging a Listen handoff
  from Decks, or a Decks handoff from Listen, fails with `401`.
- Every Decks session stores `crate-decks` as its `app_id`, whatever the
  version in the header, so a device keeps its session across upgrades and
  login methods.
- Decks sends `X-Device-Fingerprint` with a random ID created once per install.
  The server never derives one for Decks: every machine running the same build
  sends the same headers, so a derived fingerprint would merge them into one
  session, and logging out on one would revoke the others. Without the header,
  each login creates a new session.
- Decks stores the refresh token in the OS keychain and never in its
  configuration files.
- `NATIVE_OAUTH_EXCHANGE_ENABLED` also switches off the Decks flow (`503`).
