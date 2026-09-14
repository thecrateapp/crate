# Crate Custom Cast Receiver Design

**Status:** Approved for implementation  
**Date:** 2026-09-14  
**Target branch:** `codex/listen-design-system`

## Goal

Replace Google Cast's Default Media Receiver with a Crate-owned Custom Web
Receiver. The receiver must provide reliable remote playback, a branded TV
experience, receiver-owned queue continuity, and a foundation for a real
time-synchronised spectrum without making the sender the playback authority.

The receiver complements the platform senders; it does not replace them.
Crate will keep the Web Sender and the existing native Capacitor bridges for
Android and iOS. Tauri is explicitly outside the first two delivery slices.

## Delivery slices

### Slice 1: branded receiver and authoritative queue

- Custom CAF Web Receiver hosted by Crate.
- Crate Now Playing UI with artwork, metadata, quality, progress, playback
  state, and a three-item queue preview.
- Full queue transferred to and governed by the receiver.
- Queue mutation and session recovery from Web, Android, and iOS senders.
- Active Listen skin and resolved light/dark mode represented using a safe TV
  token subset.
- Receiver telemetry, bounded playback recovery, and production rollout.

### Slice 2: real spectrum

- Persistent, time-indexed spectral data generated under the resource
  governor.
- Lazy generation for missing tracks, then reuse on future sessions.
- Canvas renderer synchronised to CAF `currentTime`.
- A short Web Audio feasibility spike may provide an immediate optimisation,
  but it is not the canonical or only supported source.

### Future slices

- Slice 3 or 4 may add synchronised lyrics, Jam, collaborative queue editing,
  richer artist context, or TV-specific interaction.
- Tauri Cast support is deferred until usage justifies either a browser
  handoff or the maintenance cost of an unofficial native sidecar.

## Decisions

| Area | Decision |
| --- | --- |
| Receiver type | Custom Web Receiver using CAF as the playback engine |
| TV composition | Balanced Now Playing: artwork left, playback centre, queue right |
| Queue authority | Receiver is authoritative while casting |
| Explicit disconnect | Disconnect leaves TV playing; Stop Cast stops and revokes |
| Hosting | Central Crate receiver with separate development and production app IDs |
| UI runtime | React + Vite for discrete UI state; Canvas/CSS for high-frequency rendering |
| Appearance | Follow the sender's active skin and resolved mode using known TV-safe tokens |
| Spectrum | Persisted analysis generated lazily and synchronised by playback time |
| Recovery | Two retries, skip one failed item, stop after three consecutive item failures |
| Platforms | Web, Capacitor Android, and Capacitor iOS; no Tauri in slices 1–2 |

## Architecture

```text
Listen Web ───────────────┐
Capacitor Android bridge ─┼─ CAF sender protocol ──> Crate Web Receiver
Capacitor iOS bridge ─────┘                              │
                                                       ├─ CAF media player
                                                       ├─ Crate TV UI
                                                       └─ Crate protocol v1
                                                                │
                                                                v
Crate API <── scoped playback-session lease ── audio / metadata / artwork
    │
    └── workers ── receiver-safe transcodes and spectral artefacts
```

The standard CAF media namespace remains authoritative for load, play, pause,
seek, volume, queue cursor, and media status. A Crate namespace carries only
data or commands not represented by CAF. The reserved Google media namespace
must never be duplicated.

Proposed custom namespace:

```text
urn:x-cast:app.cratemusic.crate.v1
```

The protocol package must contain serialisable types, runtime validation, and
language-neutral JSON fixtures without React or browser dependencies. Every
message includes a protocol version, message id, and message type. Replies use
`replyTo`. Unknown additive fields are ignored; unsupported major versions
degrade to standard CAF playback.

Queue structure uses a monotonic `queueRevision`. Dynamic receiver state uses
a separate monotonic `stateSeq`, so progress updates never look like structural
queue edits. Queue edits receive either `queue.ack` or an authoritative
`queue.snapshot`; conflict recovery adopts that snapshot before replaying one
still-valid user intent.

## Receiver application

Create a new npm workspace at `app/cast-receiver`.

Responsibilities:

- Start `CastReceiverContext` and `PlayerManager` before mounting application
  UI.
- Intercept and validate initial load and queue data.
- Bind playback state through `PlayerDataBinder` and CAF events.
- Render the current track, queue preview, progress, quality, and errors.
- Publish Crate-specific status such as queue revisions and recoverable error
  codes.
- Fetch only scoped receiver resources.
- Record receiver health and failures without recording signed URLs.

React owns structural states that change infrequently. Progress is rendered
through a CSS transform or an isolated external store. Spectrum is rendered on
Canvas. Neither should rerender the whole React tree at playback frequency.

The initial compressed application budget is 150 KB excluding Google's CAF
runtime and optional lazy chunks. Spectrum, Sentry, and later lyrics should be
separate chunks where practical.

## TV composition

The approved layout divides the safe content area approximately as follows:

- 34%: square artwork and artwork fallback.
- 40%: title, artist, album, quality, progress, duration, and state.
- 26%: up to three upcoming queue items.

The layout reserves a 10% overscan-safe margin and scales typography by TV
breakpoint. Small display receivers may hide the third upcoming item before
reducing primary metadata. Audio-only receivers receive the same media session
without depending on visual UI.

States:

1. `launching` / `idle`: Crate branding and receiver readiness.
2. `loading` / `buffering`: stable previous metadata with visible activity.
3. `playing` / `paused`: full Now Playing composition.
4. `recovering`: non-destructive retry feedback.
5. `error`: actionable terminal state without a black screen.

Artwork transitions and ambient backgrounds must be bounded for older Cast
hardware. Reduced-motion mode removes non-essential transitions. Missing or
low-resolution artwork uses a deterministic Crate fallback and is not enlarged
without limit.

## Appearance contract

The sender transmits:

- `skinId`;
- preferred mode and resolved `dark` or `light` mode;
- reduced-motion preference;
- an optional bounded artwork palette;
- sender appearance-contract version.

The receiver ships its own mapping from known skin IDs to TV-safe semantic
tokens. It does not accept arbitrary CSS, token maps, or user-provided colour
values. Unknown skins and incompatible appearance versions fall back to the
Default skin while retaining the resolved colour mode.

Only foundations and visual identity tokens should be shared with
`@crate/ui`. Interactive primitives and Listen layout components must not enter
the receiver bundle. Artwork colours may modulate the ambient background but
cannot override text contrast, focus, error, or playback-state tokens.

## Playback-session lease

Per-track tickets currently expire in at most one hour and are not sufficient
for an autonomous long queue. Slice 1 introduces an ephemeral Cast playback
session created by an authenticated sender.

The creation request contains stable track references, current index, current
position, shuffle, repeat, target receiver, receiver capabilities, and the
initial queue revision. The API returns an opaque session lease and bootstrap
data suitable for the receiver.

Lease properties:

- Stored only as a hash server-side.
- Grants access only to the captured queue and receiver resources.
- Does not grant general library or user API access.
- Has an eight-hour absolute lifetime and a 30-minute idle timeout.
- Refreshes receiver-safe stream access as items approach playback.
- Is revoked by Stop Cast and expires if explicit revocation cannot be
  delivered.
- Must be redacted from logs, metrics, traces, errors, and Sentry breadcrumbs.

The current item and immediate successor are prepared eagerly. Remaining items
are resolved lazily so long queues do not enqueue unnecessary transcodes.

The existing single-track ticket endpoints remain as a compatibility path
during rollout and may be used by the Default Receiver fallback.

## Queue ownership and reconciliation

During an active Cast session, the receiver owns:

- current item and playback cursor;
- effective queue ordering;
- repeat and shuffle state;
- item completion and bounded skip decisions.

Listen remains a queue editor. Add, remove, move, clear, shuffle, and repeat
operations carry a monotonic `queueRevision`. The receiver accepts only the
expected next revision and returns its effective queue state. On a revision
conflict, the sender first adopts receiver state, reapplies a still-valid user
intent once, and does not retry indefinitely.

Mutation idempotency is persisted per session rather than remembering only the
latest mutation. On reconnect, the sender adopts receiver state before enabling controls. It
must not reload the current item or reset progress. Browser suspension or
sender closure does not stop playback.

The first two slices support multiple reconnecting instances for the same user
but not simultaneous collaborative editing. Jam and multi-user conflict
resolution remain outside scope.

## Playback authority and history

Exactly one runtime may own playback at a time: `local`, `cast`, `connect`, or
`jam`. Starting Cast performs an explicit handoff and is rejected while a
locked Jam session cannot yield authority. Restore-on-mount must discover and
adopt an active Cast session before it considers resuming local audio. Losing a
receiver never starts local playback automatically.

While the receiver can continue without a sender, it is the sole producer of
play checkpoints. The backend derives user and track from the scoped lease and
deduplicates events with an id composed from session id, queue occurrence, and
play attempt. Sender-side play tracking is disabled while Cast owns authority,
preventing both missing autonomous plays and duplicate scrobbles.

## Sender integration

### Web

- Replace `chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID` with the configured
  Crate app ID.
- Load a CAF queue rather than manually loading each next item.
- Subscribe to receiver and media status as the source of player progress.
- Implement Crate protocol messages and capability negotiation.

### Android

- Configure the Crate app ID in `CrateCastOptionsProvider` through build
  resources or flavor configuration.
- Extend `CrateCastPlugin` with queue load/mutation, complete status events,
  disconnect semantics, and Crate namespace messages.
- Keep discovery and session handling in Google's native Android SDK.

### iOS

- Configure the Crate app ID through build configuration and
  `GCKDiscoveryCriteria`.
- Extend `CrateCastPlugin` with the same queue, state, disconnect, and protocol
  semantics as Android.
- Initialise Cast early enough to retain native session resumption.

### Tauri

Cast remains unavailable. The receiver design must not add a fake web sender
or assume that an embedded WebView exposes Chrome Cast APIs. A later slice may
design a browser handoff separately.

## Disconnect semantics

- **Disconnect:** detach the sender and leave receiver playback running.
- **Stop Cast:** stop media, end the receiver session, revoke the playback
  lease, clear local Cast authority, and return Listen to local idle state.
- **Unexpected sender loss:** continue on the receiver.
- **Unexpected receiver loss:** sender clears Cast authority and presents a
  reconnect action; local playback never starts automatically.

## Recovery policy

For a media-item failure, the receiver retries twice with bounded backoff. If
the item remains unavailable, it records and reports the failure, marks the
item skipped, and advances. Three consecutive failed items stop playback and
surface a terminal queue error.

Error handling by class:

| Failure | Behaviour |
| --- | --- |
| Expired or rejected resource lease | Refresh scoped access once, then apply normal retry policy |
| HTTP 425 / transcode preparing | Respect `Retry-After` and remain in preparing state |
| Timeout or temporary network loss | Bounded backoff and retry |
| Unsupported source format | Request a receiver-safe variant |
| Artwork or rich metadata unavailable | Continue playback with fallback UI |
| Spectrum unavailable | Continue playback without reactive visualisation |
| API lost after media load | Finish loaded media and retry preparation for the next item |
| Session revoked | Stop immediately and clear receiver state |

Errors use stable codes shared by backend, receiver, and senders. Human copy is
owned by each UI and must not be transported as the protocol contract.

## Spectrum artefact

The canonical spectrum is a persisted, time-indexed artefact:

- 24–32 perceptual frequency bands;
- 10–15 frames per second;
- unsigned 8-bit magnitudes;
- compressed and chunkable;
- versioned by analyser implementation and source fingerprint.

The receiver requests a manifest for the current track. Existing artefacts are
streamed or prefetched. Missing artefacts enqueue an analysis task governed by
the same resource and maintenance constraints as other DSP work. A bounded
non-reactive ambient visual is shown while analysis is unavailable.

Canvas selects and interpolates frames from CAF `currentTime`; pause freezes
the visual and seek jumps directly to the corresponding frame. Playback never
waits for spectrum data.

The Web Audio spike must test real Cast hardware, cross-origin streams,
transcoded variants, seek, pause, and session recovery. A successful result may
be used as an opportunistic live source, but persisted data remains the stable
cross-device contract.

## Security

- The receiver never receives user bearer or refresh tokens.
- Receiver URLs use scoped opaque leases and HTTPS in production.
- Public receiver endpoints allow only the methods and CORS headers required
  by CAF and media range requests.
- Session and item identifiers are validated against the lease snapshot.
- Queue mutations require an attached authorised sender channel and valid
  revision.
- No arbitrary receiver origin, CSS, script, image, or metadata HTML is
  accepted.
- Signed URL query strings and lease values are redacted at every telemetry
  boundary.

## Observability

Receiver telemetry includes:

- launch success and launch latency;
- CAF and receiver versions;
- device category without invasive fingerprinting;
- media load and first-audio latency;
- buffering, retry, skip, and terminal failure codes;
- queue mutation conflicts;
- reconnect and session-resume outcomes;
- metadata, artwork, and spectrum availability;
- clean disconnect and Stop Cast outcomes.

Receiver Sentry must use a separate release name and environment. Sampling
must keep routine progress and media status out of breadcrumbs. URLs are
sanitised before capture.

## Test strategy and quality gates

Implementation follows TDD. Every slice must leave the existing Cast tests,
React Doctor, lint, type checking, builds, and relevant backend suites green.

### Protocol and state

- Schema validation and forward-compatible additive fields.
- Major-version fallback to standard CAF playback.
- Queue revision acceptance, conflicts, reconnect, and idempotency.
- Disconnect versus Stop Cast semantics.
- Retry, skip, and consecutive-failure state machine.

### Backend

- Lease scope, hashing, expiration, idle timeout, revocation, and redaction.
- Queue membership checks and forbidden track access.
- Range requests and receiver CORS.
- Lazy transcode and spectrum preparation.
- No filesystem writes from API endpoints.

### Receiver

- CAF adapters tested against a deterministic fake runtime.
- React states tested with Vitest and Testing Library.
- Canvas scheduling tested independently from React.
- Visual regression at 1920×1080 and 1280×720 for every state, default skin,
  Crate Red, dark, light, missing artwork, and long metadata.
- Overscan-safe-area and reduced-motion assertions.

### Native senders

- Android and iOS app-ID configuration by environment.
- Queue load, mutations, controls, state events, resumption, and both end
  semantics.
- Shared contract fixtures consumed by TypeScript, Android, and iOS tests.

### Hardware acceptance

- Registered development Chromecast or Cast-enabled TV.
- Web, Android, and iOS launch and reconnect.
- Sender sleep or closure while the queue advances.
- Seek, pause, volume, next, previous, repeat, and shuffle.
- Receiver/API interruption and recovery.
- Long queue exceeding the old one-hour ticket window.
- Production-like HTTPS plus a LAN-accessible self-hosted Crate instance.

No slice is complete based only on mocked CAF tests. Hardware evidence and a
documented rollback are release gates.

## Deployment and rollback

Register two Custom Web Receiver applications:

- `Crate Cast Dev`, restricted to registered test devices.
- `Crate Cast`, published for production devices.

Host immutable hashed assets behind stable environment entry points. Receiver
deployment is independent from the main Crate container release. Each release
keeps a rollback target, protocol compatibility range, and Sentry release.

Rollout order:

1. Deploy and validate the development receiver.
2. Enable the custom app ID for local Web Sender tests.
3. Validate Android and iOS development builds.
4. Publish the production receiver while senders retain Default Receiver
   fallback.
5. Enable custom receiver selection behind a server-controlled capability.
6. Observe launch, load, buffering, and failure rates.
7. Remove fallback only after a stable release window.

Rollback switches senders to the Default Receiver app ID and revokes creation
of new playback sessions. Existing sessions may finish or be explicitly ended;
the receiver static release remains available long enough to avoid breaking
active playback.

## Explicit non-goals

- Tauri Cast sender implementation.
- Jam or collaborative multi-user queue editing.
- Arbitrary receiver themes, CSS, or plugin code.
- Lyrics in the first two slices.
- Replacing CAF's media engine or standard control protocol.
- Making spectrum availability a playback requirement.

## Implementation planning boundary

The implementation plan should divide slice 1 into independently testable
backend lease, shared protocol, receiver shell, queue, sender, native, visual,
and rollout cuts. Slice 2 should remain a separate sequence after slice 1 is
validated on real hardware.
