> **SUSTITUIDO — 2026-09-09. Documento histórico, no usar para continuar el desarrollo.**
> Las únicas guías vigentes de Smart Mix, crossfade Android nativo y VirtualDJ
> son el [diseño unificado](../../docs/technical/smart-mix-design.md) y el
> [plan de implementación](../../docs/technical/smart-mix-implementation-plan.md). Sus contratos, tareas y gates sustituyen
> los de este documento, incluso cuando el texto histórico diga aprobado o completo.
> El contenido inferior se conserva como evidencia del spike; no es una guía operativa vigente.

# Crate VirtualDJ plugin

This directory contains the native VirtualDJ integration. The plugin is kept
inside the monorepo, but the VirtualDJ SDK remains a local/private dependency.
Do not copy SDK headers or sample sources into Git.

## Dependencies

- CMake 3.24+
- C++20 compiler
- VirtualDJ SDK v8 for the real plugin target
- VIRTUALDJ_SDK_ROOT pointing to the private SDK directory
- libcurl and SQLite 3 from the system
- [nlohmann/json](https://github.com/nlohmann/json) 3.11.3, MIT license, fetched by CMake
  from the pinned release archive (SHA-256 checked); it is the only JSON parser in the
  plugin and every response goes through the bounded reader in `json_mapping`

The SDK must contain at least:

```text
vdjPlugin8.h
vdjOnlineSource.h
```

## Configure and build the headless target

This target does not require the VirtualDJ SDK:

```sh
cmake -S tools/vdj-plugin -B build/vdj-headless -G Ninja \
  -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF
cmake --build build/vdj-headless
```

## Run the SDK-independent core tests

```sh
cmake -S tools/vdj-plugin -B build/vdj-core -G Ninja \
  -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF \
  -DCRATE_VDJ_BUILD_TESTS=ON
cmake --build build/vdj-core
ctest --test-dir build/vdj-core --output-on-failure
```

## Configure and build the real plugin

```sh
export VIRTUALDJ_SDK_ROOT=/path/to/private/virtualdj-sdk
cmake -S tools/vdj-plugin -B build/vdj-macos -G Ninja \
  -DCRATE_VDJ_BUILD_REAL_PLUGIN=ON
cmake --build build/vdj-macos
```

The integration produces two macOS `.bundle` or Windows `.dll` artifacts: one
General control plugin and one Online Source plugin. They must be installed in
their respective VirtualDJ plugin directories for the manual gate:

```text
crate_vdj_control.bundle       -> PluginsMacArm/AutoStart/
Crate.bundle                    -> PluginsMacArm/OnlineSources/
```

Do not install the same binary in both directories. The output must not be
committed.

The Online Source identifies itself to VirtualDJ as `Crate` and packages the
Crate provider icon in its bundle resources.

## Deferred browser UI option

The separate custom browser UI spike was removed. The preferred future option
is a custom VirtualDJ skin with a Crate tab visually integrated into the
SideView, backed by a docked plugin panel. This remains deferred while the
native Online Source integration is completed.

## Local Crate pilot

The first pilot targets the development API, never production:

```text
https://api.dev.lespedants.org
```

The local compose stack enables `CRATE_VDJ_ENABLED` and
`CRATE_SMART_MIX_ENABLED`, while keeping automation disabled. Discover the
server contract with `GET /api/capabilities`, then send the opaque VDJ token
as a Bearer token to the scoped endpoints. The token is created from an
interactive Listen session through `POST /api/auth/access-tokens`; the raw
secret is returned only on creation/rotation and must be stored in the system
credential store.

For the development readplane overlay, Bearer tokens with the `crv_` prefix
are routed to FastAPI so the pilot exercises the real access-token resolver.
This routing is intentionally local to `data/caddy/Caddyfile.readplane.dev`.

On macOS, seed the token into Keychain without putting it in a file:

```sh
security add-generic-password -U \
  -s org.cratemusic.virtualdj \
  -a access-token \
  -w
```

The command prompts for the opaque token. For the local pilot, trust the
current Caddy development CA and launch VirtualDJ with the development origin
configured:

```sh
docker cp crate-dev-caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt
launchctl setenv CRATE_VDJ_CA_BUNDLE /tmp/caddy-root.crt
launchctl setenv CRATE_VDJ_API_ORIGIN https://api.dev.lespedants.org
open -a /Applications/VirtualDJ-dev/VirtualDJ.app
```

`CRATE_VDJ_CA_BUNDLE` is only needed for the local Caddy certificate. It keeps
TLS verification enabled by explicitly adding the current development CA to
the native libcurl client. Do not disable certificate verification or set this
variable for production origins.

## Metadata cache

Search results and catalog pages use a local SQLite cache. Entries are scoped
by API origin and credential account key, so switching between Crate
instances or users cannot reuse another scope's metadata.

The default locations are:

```text
macOS:   ~/Library/Application Support/VirtualDJ/Cache/crate-metadata.sqlite
Windows: %APPDATA%/VirtualDJ/Cache/crate-metadata.sqlite
```

Set `CRATE_VDJ_METADATA_CACHE` to override the database path, which is useful
for local tests and isolated pilots. Entries remain fresh for 24 hours and may
be served for a further 24 hours when the API is unavailable. The store keeps
at most 256 entries using LRU eviction. Cached payloads contain metadata only:
track filesystem paths and signed or secret-bearing artwork URLs are never
persisted.

The native live smoke gate uses the same Keychain entry and API origin:

```sh
CRATE_VDJ_LIVE_TEST=1 \
CRATE_VDJ_API_ORIGIN=https://api.dev.lespedants.org \
  build/vdj-macos/crate_vdj_factory_contract
```

## Compatible-track context action

The Online Source adds `Show compatible tracks` to a track's context menu
(`Mostrar pistas compatibles` when VirtualDJ is configured in Spanish). The
action selects the track as the Smart Mix seed and immediately navigates
VirtualDJ to a stable compatible-tracks folder. Opening that folder requests
the server-ranked results with `scope=local` and
`planner_version=smart-mix-v1`; when a Crate track is currently loaded, the
plugin obtains its `netsearch://` path through VirtualDJ's `get_filepath` and
uses that track as the seed automatically. The server order and score
breakdown are preserved in the VirtualDJ track comments. A missing Smart Mix
profile produces an empty folder with a logged `missing_profile` fallback.

The explicit context-menu seed has priority for that folder open; subsequent
opens return to the automatic playing-track behavior. If no Crate track is
loaded, the folder finishes empty.

The Online Source SDK exposes the current `IVdjTracksList`, but it does not
expose a direct SideView/SideList writer. VirtualDJ's VDJScript has
`sidelist_load`/`sidelist_add` commands, so copying compatible results into the
user's SideList is technically possible as a separate host-integration step;
the current action deliberately keeps the results in the temporary Crate
folder until that command sequence is validated against the running host.

## Stream resolution

The Online Source now resolves a real track through the development API:

1. Resolve playback through `/api/vdj/tracks/by-entity/{entity_uid}/playback`.
2. Request a short-lived, exact-path stream ticket through
   `/api/auth/media-access`.
3. Return `/api/vdj/tracks/by-entity/{entity_uid}/stream?media_ticket=...` to
   VirtualDJ.

The PAT is sent only as an Authorization header. The plugin does not persist
the ticket or signed URL; the ticket remains bounded to one stream path and
expires after one minute. The VDJ media route is intentionally sent directly
to FastAPI, leaving the read plane out of the first pilot.

## Catalog folders

The Online Source exposes the first-level collections returned by
`GET /api/vdj/catalog/folders`:

```text
Playlists
Genres
Moods
Recently Played
```

Selecting a collection reads bounded pages from
`GET /api/vdj/catalog/folders/{folder_id}`. The plugin follows at most five
pages per VirtualDJ folder request, maps the same entity UIDs and metadata as
search, and uses the album cover route when artwork is available. Folder
queries are scoped by the same `vdj.catalog.read` token; Playlists and
Recently Played are resolved for the token owner.

## Smart Mix profile consumption

The plugin can request the compact Smart Mix profile for a track through:

```text
GET /api/tracks/by-entity/{entity_uid}/mix-profile?detail=summary
```

The current client accepts profile version `1` and analyzer version
`smart-mix-v1`. It maps BPM, key/Camelot, confidence, energy, spectral
density, and intro/outro cues for future VirtualDJ display and mixing
features. The full beat grid is deliberately not requested or persisted in
this first cut. A `404` is represented as an unavailable profile so callers
can continue with normal track metadata and playback.

## Current manual gate

Use the checklist in
tools/vdj-plugin/tests/sdk/control_spike_contract.md. Search and stream
resolution are connected to the real Crate API, as is bounded folder browsing.
