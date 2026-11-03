---
title: Crate Decks server contract
summary: What the server offers the Crate Decks desktop DJ client - session, capabilities and the fields it relies on.
section: reference
audience: [developer]
status: canonical
order: 35
verified: 2026-11-03
sources:
  - app/crate/api/auth.py
  - app/crate/api/native_oauth_auth.py
  - app/crate/api/capabilities.py
  - app/crate/api/schemas/capabilities.py
  - app/tests/test_auth_decks_client.py
  - app/tests/test_capabilities_decks.py
---

# Crate Decks server contract

Crate Decks is a desktop DJ client built on Mixxx. It uses a Crate server as its
library: it browses and searches the user's local library, downloads original
audio, imports Smart Mix profiles and asks the planner for transition plans. It
lives in its own repository; this page is the server side of the contract. The
server changes are additive and are announced through `GET /api/capabilities`,
so Listen, VirtualDJ and OpenSubsonic clients are not affected.

## Session (S1)

Decks is a first-class native client with the same session policy as Listen. It
sends `X-Crate-App: decks/<version>` on every request, logs in with email and
password or with native OAuth (app ID `crate-decks`, PKCE, loopback callback on
`http://127.0.0.1:<port>/callback`), and receives a refresh token. It is
bearer-only: the server never sets auth cookies for it. The full rules are in
the native authentication contract (`docs/technical/listen-native-auth-contract.md`,
section "Native clients: Listen and Crate Decks").

`crv_` access tokens keep working for VirtualDJ and automations; Decks does not
need them.

## Capabilities (S2)

`GET /api/capabilities` includes a `decks` section for every caller:

```json
{
  "decks": {
    "available": true,
    "min_client_version": "0.1.0",
    "contract_version": 1,
    "features": []
  }
}
```

| Field                | Meaning                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `available`          | The server accepts the Decks client                                       |
| `min_client_version` | Oldest Decks version (semver) the server supports                         |
| `contract_version`   | Integer, bumped on every incompatible change to the Decks server contract |
| `features`           | Decks server contracts this instance serves                               |

Rules:

- `contract_version` changes only on incompatible changes. The server PR that
  makes one bumps it, and the client handles both versions for one release.
  Additive changes only add a value to `features`.
- Clients ignore unknown `features` values and degrade when one is missing.
- Each feature is added by the server change that implements it:

  | Feature                                       | Server change                         |
  | --------------------------------------------- | ------------------------------------- |
  | `library_cursor`                              | S3, paginated navigation for clients  |
  | `profiles_batch`                              | S4, batch mix profiles                |
  | `beatmatch`, `bass_handoff`, `long_beatmatch` | S5, `decks` context in the planner    |
  | `cues`                                        | S7, synchronised cues and corrections |

  None ships yet, so `features` is empty. Decks features never follow the
  Android Smart Mix flags (`CRATE_ANDROID_*`); `smart_mix.android_*` remains
  the Android contract.

The constants live in `app/crate/api/capabilities.py`
(`DECKS_CONTRACT_VERSION`, `DECKS_MIN_CLIENT_VERSION`, `_decks_features`), and
the allowed feature names in `DecksFeature`
(`app/crate/api/schemas/capabilities.py`).
