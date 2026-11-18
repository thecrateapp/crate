# Crate Connect v2 — Rewrite (Spotify Connect Model)

> **Estado (2026-11-18):** Núcleo v2 implementado (app/crate/api/connect_ws.py, connect_state, connect_ws_hub, PR #188). Pendiente: retirar v1 — rutas `/commands`, `/events` (SSE), `/transfer` y `/ack` en app/crate/api/connect.py, la tabla `connect_command_outbox` y los hooks `use-crate-connect-commands.ts` / `use-remote-playback-state.ts`. El endurecimiento del handoff está en [docs/plans/roadmap/05](roadmap/05-connect-automotive-design.md).

Date: 2026-05-31

## Summary

Crate Connect v1 was built as a 6-phase plan (resume → presence → transfer → remote
controls → robustness → multi-controller). The implementation completed phases 1–4
but introduced critical architectural flaws that make the feature unreliable:

- 3-layer command delivery (PostgreSQL outbox → Redis Streams → in-memory dict)
  creates unpredictable latency, duplication, and race conditions.
- Transfer is a multi-phase operation (6 steps, 2 acks, 15s timeout) without
  atomic guarantees.
- State and commands travel through separate channels, so a device can think it
  owns playback while commands telling it to stop are still in transit.
- Client-side position projection assumes NTP-synced clocks.
- Polling (SSE + HTTP fallback every 1.5s + session refresh every 2.5s) generates
  excessive API traffic and up to 3s of display lag.

**Decision**: Rewrite the transport and control layer from scratch using a
Spotify Connect-inspired model. Keep the data model (devices, playback states,
active sessions) which is correct. Replace the command bus, SSE, polling, and
outbox with a single WebSocket connection per playback instance.

## Why Spotify Connect

Spotify Connect uses 3 ideas that map directly to Crate's infrastructure:

1. **PlayerState as single source of truth** (cloud-managed, Postgres + Redis).
2. **WebSocket push to all devices** when state changes (no polling, no outbox).
3. **Transfer = atomic update to `active_instance_id`** on PlayerState (not a
   6-phase command/ack dance).

Crate already has `user_active_playback_sessions` (the PlayerState table), Redis
(for cache + pub/sub), and FastAPI (supports WebSocket natively via Starlette).
The pieces exist — they're just wired wrong.

## Target Architecture

```
                          ┌──────────────────────────┐
                          │    FastAPI /api/me/       │
                          │    connect/ws             │
                          │                           │
                          │  ┌─────────────────────┐  │
                          │  │    PlayerState       │  │
                          │  │  (Redis + Postgres)  │  │
                          │  │                      │  │
                          │  │  active_instance_id  │  │
                          │  │  track_uri           │  │
                          │  │  position_ms         │  │
                          │  │  is_playing          │  │
                          │  │  queue[]             │  │
                          │  │  volume              │  │
                          │  │  shuffle, repeat     │  │
                          │  └─────────┬────────────┘  │
                          │            │               │
                          │    WebSocket Hub           │
                          │    (broadcast room         │
                          │     per user_id)           │
                          └─────┬──────┬──────┬────────┘
                                │      │      │
                    ┌───────────┘      │      └───────────┐
                    ▼                  ▼                  ▼
              ┌──────────┐     ┌──────────┐      ┌──────────┐
              │ Desktop  │     │  Phone   │      │  Tablet  │
              │ (activo) │     │(control) │      │(observer)│
              │          │     │          │      │          │
              │ reproduce│     │ UI remota│      │ ve estado│
              │ audio    │     │          │      │          │
              └──────────┘     └──────────┘      └──────────┘
```

- 1 WebSocket connection per playback instance (tab), not per transfer.
- PlayerState is authoritative — every mutation goes through it.
- Broadcast to all devices on every state change via Redis Pub/Sub fanout
  (single-process in-memory for dev, Redis Pub/Sub for multi-worker production).
- No outbox, no Redis Streams, no command acks, no polling.
- Transfer uses 3-phase handoff: request → target preloads → commit, to avoid
  buffering gaps on the target device.

## Comparison: v1 vs v2

| Concern | v1 (current) | v2 (proposed) |
|---|---|---|
| Command transport | SSE + HTTP polling + Redis Streams + PG outbox + memory | 1 WebSocket |
| Transfer | 6-phase POST /transfer → outbox → Redis → SSE → ack → transfer_out → ack | 3-phase WS handoff: request → target preloads → commit ownership |
| Position sync | Light checkpoint POST every 10s | WS push from active device every 5s |
| Volume sync | Not implemented (optimistic in UI only) | WS push in both directions |
| Latency | 1.5s–15s (polling + SSE block) | <200ms (WS push) |
| Lines of code | ~5000 (backend + frontend) | ~1500 |
| Code to remove | ~3000 | — |

## Identity Model: device_id vs playback_instance_id

v1 conflated "device identity" with "playback ownership" — both used the same
`device_id`. This is wrong because two browser tabs share the same
`localStorage`, hence the same `device_id`, but should be treated as distinct
players for Connect ownership.

v2 separates these concerns:

| Concept | Key | Storage | Lifetime | Used for |
|---|---|---|---|---|
| `device_id` | stable UUID | localStorage / Capacitor Preferences | Survives reinstalls | Device registry, listing, labeling, forgetting |
| `playback_instance_id` | random UUID | `useRef()` (per-mount) | Per tab/mount | Active session ownership, WS connection identity, command routing |
| `device_label` | human name | localStorage | Persistent | Display in device lists |

When a tab opens:
- `device_id` is loaded from localStorage (or generated once and persisted).
- `playback_instance_id` is generated fresh on every mount (`crypto.randomUUID()`).
- The WS `hello` message sends both: `{ device_id, playback_instance_id, device_label }`.

### Naming convention across the system

To avoid ambiguity, these two IDs have distinct roles:

| Term | Where it lives | Example | Identifies |
|---|---|---|---|
| `device_id` | `user_devices`, hello, WS messages | `chrome-desktop-uuid` | Physical device. Stable across tabs/reinstalls. |
| `playback_instance_id` | PlayerState (`active_instance_id`), WS identity, transfer target | `tab-uuid-01` | Specific playback session. Ephemeral — dies when tab closes. |

**PostgreSQL column note:** `user_active_playback_sessions.active_device_id` is
repurposed to store `playback_instance_id`. No ALTER TABLE needed. Code
documents and logs it as `active_instance_id` even though the column name
stays `active_device_id`. The persistent `device_id` is always obtained from
`user_devices` via the hub's instance-to-device mapping in Redis.

When listing devices for the UI:
- `GET /api/me/devices` returns `device_id` + label + presence (as today).
- The "Active" badge is computed by checking if ANY `playback_instance_id` for
  that `device_id` is the current active session owner.

This means:
- Two Chrome tabs → two different `playback_instance_id` values, same `device_id`.
- Transfer targets a specific `playback_instance_id`, not a device type.
- If a tab closes, its `playback_instance_id` dies. The other tab is unaffected.
- The device list still shows "Chrome on macOS" once, with "Active" if either tab owns.

## PlayerState — Data Model

The PlayerState is the single structure that represents "what is playing for this
user right now". It lives in Redis as the hot copy and is flushed to
`user_active_playback_sessions` on pause/stop/transfer/pagehide.

### Redis Key

```
playerstate:{user_id}
```

TTL: 24 hours (renews on every mutation).

### Schema (JSON, stored as Redis hash or JSON)

```json
{
  "session_id": "uuid",
  "active_instance_id": "playback-uuid-tab-1",
  "active_device_id": "chrome-desktop-uuid",
  "active_device_label": "Chrome on macOS",
  "status": "playing",
  "track": {
    "id": 12345,
    "entity_uid": "uuid",
    "path": "Artist/Album/01 - Track.flac",
    "title": "H.O.O.D",
    "artist": "Kneecap",
    "album": "H.O.O.D 2025",
    "album_cover": "/api/art/12345/cover",
    "duration_ms": 173000
  },
  "position_ms": 45230,
  "position_updated_at": "2026-05-31T10:00:00.000Z",
  "volume": 0.8,
  "queue": [...],
  "current_index": 2,
  "queue_revision": "abc123",
  "shuffle": false,
  "repeat": "off",
  "play_source": { "type": "album", "id": 42, "name": "H.O.O.D 2025" },
  "unshuffled_queue": null,
  "updated_at": "2026-05-31T10:00:01.000Z",
  "version": 42
}
```

Key changes from v1:
- `active_instance_id` replaces `active_device_id` — it's the per-tab UUID,
  not the persistent device UUID.
- `active_device_id` + `active_device_label` are included for display (so
  observers can show "Playing on Chrome on macOS" without an extra API call).
- `position_updated_at` is always the **server's clock** at the time the
  position was recorded. This anchors client-side interpolation to a single
  timeline, avoiding NTP drift between devices. See "Position Interpolation"
  section below.

### Version counter

`version` is a monotonically increasing integer. Every mutation increments it.
Clients include their last known `version` in messages. The server rejects
messages with `version < current_version` (stale state detection without
playback_session_id gymnastics).

### Postgres flush

On these events, persist PlayerState to `user_active_playback_sessions` (and
update `user_playback_device_states` for the active device):

- Transfer (ownership changes)
- Pause
- Stop
- Pagehide/beforeunload (keepalive)
- Every 30s while playing (durable checkpoint)

## WebSocket Protocol

### Auth: Short-Lived WS Ticket

Browsers cannot send custom headers on `new WebSocket()`. Putting a full JWT in
the URL is bad practice (it leaks into server logs, proxy logs, and browser
history). Instead:

1. Client calls `POST /api/me/connect/ws-ticket` (authenticated REST call with
   normal cookie/bearer auth).
2. Server returns a short-lived opaque ticket (HMAC-SHA256 signed, 60s TTL)
   bound to `{ user_id, device_id }`.
3. Client opens `ws://.../api/me/connect/ws?ticket=<ticket>`.
4. Server validates the ticket, extracts user_id + device_id, immediately
   invalidates it (one-time use).

```json
// POST /api/me/connect/ws-ticket → 200
{
  "ticket": "v2.b64encoded-hmac.b64encoded-payload",
  "expires_at": "2026-05-31T10:01:00.000Z",
  "ws_url": "/api/me/connect/ws?ticket=..."
}
```

### Connection & Hello

```
ws://crate.local/api/me/connect/ws?ticket=<one-time-ticket>
```

On connect, after ticket validation, the server sends:

```json
{
  "type": "hello",
  "payload": {
    "user_id": 1,
    "server_time": "2026-05-31T10:00:00.000Z"
  }
}
```

The client MUST respond with its own `hello` identifying itself:

```json
{
  "type": "hello",
  "payload": {
    "device_id": "chrome-desktop-uuid",
    "playback_instance_id": "tab-uuid-fresh-every-mount",
    "device_label": "Chrome on macOS",
    "device_type": "desktop",
    "app_platform": "listen-web",
    "app_version": "1.4.1-beta",
    "capabilities": {
      "can_play": true,
      "can_receive_commands": true,
      "can_set_volume": true
    }
  }
}
```

The server registers the instance and sends the current PlayerState:

```json
{
  "type": "player_state",
  "payload": { /* full PlayerState */ },
  "version": 42,
  "timestamp": "2026-05-31T10:00:01.000Z"
}
```

After the `hello` handshake, the server upserts the device in `user_devices`
(if new or label changed) and marks presence.

### Message Types

All messages are JSON with `{ "type": "...", "payload": {...}, "version": 42 }`.

#### Client → Server

| type | payload | Description | Who can send |
|---|---|---|---|
| `hello` | `{ device_id, playback_instance_id, device_label, ... }` | Identify this playback instance after WS open | All (required, first message) |
| `claim_active` | `{ "position_ms": 45230 }` | This instance starts playing, claims ownership | Any instance when user taps play |
| `transfer_request` | `{ "target_instance_id": "tab-uuid-xyz" }` | Request transfer to another instance | Any instance |
| `transfer_ready` | `{ "transfer_id": "uuid" }` | Target confirms preloaded and ready to play | Target instance only |
| `transfer_cancel` | `{ "transfer_id": "uuid", "reason": "..." }` | Target cannot accept transfer | Target instance only |
| `update_position` | `{ "position_ms": 46230 }` | Periodic position heartbeat | Active instance only |
| `update_status` | `{ "status": "paused" }` | Play/pause/stop | Active instance only |
| `update_queue` | `{ "queue": [...], "current_index": 2, ... }` | Queue structural change | Active instance only |
| `update_volume` | `{ "volume": 0.5 }` | Volume change | Active instance only (hardware) or any (remote) |
| `update_shuffle` | `{ "shuffle": true }` | Shuffle toggle | Active instance only |
| `update_repeat` | `{ "repeat": "all" }` | Repeat mode change | Active instance only |
| `seek` | `{ "position_ms": 94000 }` | Seek to position | Any instance |
| `next_track` | `{}` | Skip to next track | Any instance |
| `previous_track` | `{}` | Skip to previous track | Any instance |
| `pause` | `{}` | Pause active instance | Any instance |
| `resume` | `{}` | Resume active instance | Any instance |
| `heartbeat` | `{}` | Keepalive | Any connected instance |

#### Server → Client

| type | payload | Description |
|---|---|---|
| `hello` | `{ "user_id": 1, "server_time": "..." }` | Server handshake; client must respond with its own `hello` |
| `player_state` | full PlayerState | Initial state after hello |
| `player_state_update` | partial PlayerState changes + `version` | Push on any mutation |
| `transfer_incoming` | `{ "transfer_id": "uuid", "source_instance_id": "...", "state": {...} }` | Target: preload this state and ack with `transfer_ready` |
| `transfer_committed` | `{ "active_instance_id": "...", "active_device_label": "..." }` | Target: you now own playback. Source: pause now. |
| `transfer_failed` | `{ "transfer_id": "uuid", "reason": "timeout" }` | Transfer did not complete; source remains active |
| `became_inactive` | `{ "active_instance_id": "...", "active_device_label": "..." }` | Another instance took over; pause local |
| `seek` | `{ "position_ms": 94000 }` | Remote seek command (directed, not broadcast) |
| `next_track` | `{}` | Remote next command (directed) |
| `previous_track` | `{}` | Remote previous command (directed) |
| `pause` | `{}` | Remote pause command (directed) |
| `resume` | `{}` | Remote resume command (directed) |
| `volume` | `{ "volume": 0.8 }` | Remote volume command (directed) |
| `error` | `{ "code": "...", "message": "..." }` | Rejected mutation |
| `heartbeat_ack` | `{}` | Heartbeat response |

### Protocol Details

#### `hello` (client → server)

Required as the first client message. The server verifies the ticket was
validated for this `device_id`. Registers/updates `user_devices`, marks
presence in Redis. After processing, sends `player_state`.

If the hello is not received within 5 seconds of WebSocket open, the server
closes the connection.

#### `claim_active`

An instance that starts playing locally (user tapped play) sends this. The server:

1. Validates the instance exists in the connection hub.
2. Updates `active_instance_id` to this instance.
3. If a previous active instance exists and is connected, pushes
   `became_inactive` to it, telling it to pause.
4. Broadcasts `player_state_update` with the new state to ALL instances.

The previous instance, on receiving `became_inactive`, MUST pause its local
audio engine. It does not need to ack — the server already updated the state.
If it is offline, it will receive the state on next connect.

#### `transfer_request` → `transfer_ready` → `transfer_committed` (3-phase handoff)

v1 had a race condition: the source device paused before the target had even
loaded the audio stream. This created a 1-5 second gap of silence. v2 uses a
3-phase handoff:

```
Source                    Server                   Target
  │                          │                        │
  │─ transfer_request ──────►│                        │
  │    { target_instance_id }│                        │
  │                          │─ transfer_incoming ───►│
  │                          │   { state, transfer_id}│
  │                          │                        │── preload stream
  │                          │                        │   resolve track URLs
  │                          │                        │   push to audio engine
  │                          │          transfer_ready│── (autoplay=false)
  │                          │◄───────────────────────│
  │                          │                        │
  │                          │─ transfer_committed ──►│  (now autoplay)
  │                          │◄── become_inactive ────│── start playback
  │── pause local ◄───────── │                        │
  │                          │                        │
  │                          │─ player_state_update ─►│  to all observers
```

**Step 1: `transfer_request`**

Client sends `{ target_instance_id }`. Server:
1. Validates both source and target are connected.
2. Reads current PlayerState and freezes `position_ms` + `position_updated_at`.
3. Generates a `transfer_id` (UUID).
4. Sets `transfer_state = "pending"` + `transfer_id` on the PlayerState
   (prevents `claim_active` races during handoff).
5. Sets `transfer_deadline = now + 10s` (in Redis).
6. Pushes `transfer_incoming` to target with full state payload.

**Step 2: `transfer_ready`**

Target loads the queue, resolves track URLs, pushes tracks to audio engine
(with `autoplay: false`), seeks to `position_ms`. When ready, sends
`transfer_ready { transfer_id }`. Server:
1. Validates `transfer_id` matches the pending transfer.
2. Atomically updates PlayerState: `active_instance_id = target`,
   `transfer_state = "committed"`, `status = "playing"`.
3. Pushes `transfer_committed` to target.
   Target: starts playback locally (unmutes/resumes audio engine).
   Target: sends `update_status { status: "playing" }` and `update_position { position_ms }`
   to confirm. **Does NOT send `claim_active`** — the server already committed ownership.
4. Pushes `became_inactive` to source (it pauses).
5. Broadcasts `player_state_update` to all other instances.

**Timeout (10s)**

If `transfer_ready` is not received within 10s:
1. Server sets `transfer_state = null`.
2. Pushes `transfer_failed` to both source and target.
3. Source remains active, no pause happens.

**Edge case: target `transfer_cancel`**

If the target cannot load the state (e.g., network error resolving tracks), it
sends `transfer_cancel { transfer_id, reason }`. Server reverts `transfer_state`
to null, source stays active.

#### `update_position`

The active instance sends position updates periodically (every 5s while playing,
immediately on pause/seek). The server:

1. Validates `playback_instance_id === active_instance_id`.
2. Updates `position_ms` and sets `position_updated_at = server_now()`.
3. Broadcasts `player_state_update` with ONLY the position fields to all
   observer instances (non-active).

The server records `position_updated_at` using its own clock — not the
client's. This is critical for correct interpolation by observers (see
"Position Interpolation" below).

This replaces the current `PUT /api/me/playback-state/current` light checkpoints.

#### Position Interpolation (Observer-Side)

Observer instances (not the active player) show a smooth seekbar. They
interpolate between WS `player_state_update` position pushes:

```
displayed_position_ms = position_ms + (Date.now() - server_time_at_receipt + server_clock_offset)
```

Where `server_clock_offset` is computed once at hello:

```
server_clock_offset = server_time - Date.now()  // (cached per connection)
server_time_at_receipt = position_updated_at    // from PlayerState
```

The `position_updated_at` is the server's clock at the time the active instance
reported the position. The observer uses this to compute "how long has the
server believed this position to be current" and advances it linearly. This is
**purely cosmetic** — the authoritative value is always the last
`player_state_update.position_ms`. The interpolation is clamped to
`[0, duration_ms]` and resets on each `player_state_update`.

Key difference from v1: v1 interpolated using the client's local clock as the
anchor (`Date.now() - activeConnectStateFetchedAt`), which assumed NTP sync
between devices. v2 anchors to the server clock, which is the same for all
observers. NTP drift between observer and server still exists but is a single
offset, not between peers. The offset is measured at hello and can be refined
on each server message.

#### `seek`, `next_track`, `previous_track`, `pause`, `resume`

These are remote control commands. Any instance can send them. The server:

1. Validates there is an active instance and no transfer is pending.
2. Pushes a directed message to the active instance's WebSocket (not broadcast).
3. Does NOT update PlayerState immediately — waits for the active instance to
   confirm via `update_position` / `update_status` / etc.

The active instance processes the command locally and sends the resulting state
change back via the normal update messages.

For `pause`/`resume`: the observer sends the command, the active instance pauses
or resumes, then sends `update_status { status: "paused" | "playing" }`. The
server broadcasts the status change to all observers so their UI reflects it.

For `seek`: same pattern. Observer sends seek position, active instance seeks,
sends `update_position` with new position. Server broadcasts.

For `next_track`/`previous_track`: active instance skips tracks, sends
`update_queue` with new index + `update_position` at 0. Server broadcasts.

#### Instance Visibility in Device Listing

`GET /api/me/devices` currently returns one entry per `device_id`. With v2,
multiple playback instances may share the same `device_id` (two Chrome tabs).
The UI needs to know which specific instance is the active player to show
correct transfer targets.

Two additions:

1. **Device list response extended with `instances` field:**

```json
{
  "devices": [
    {
      "device_id": "chrome-desktop-uuid",
      "device_label": "Chrome on macOS",
      "active": true,
      "instances": [
        {
          "playback_instance_id": "tab-uuid-1",
          "connected_at": "2026-05-31T10:00:00Z",
          "is_active": true
        },
        {
          "playback_instance_id": "tab-uuid-2",
          "connected_at": "2026-05-31T10:05:00Z",
          "is_active": false
        }
      ]
    }
  ]
}
```

2. **WebSocket `connected_instances` snapshot** — pushed to all instances
   whenever an instance connects or disconnects:

```json
{
  "type": "connected_instances",
  "payload": {
    "instances": {
      "tab-uuid-1": { "device_id": "chrome-...", "device_label": "Chrome on macOS" },
      "tab-uuid-3": { "device_id": "iphone-...", "device_label": "iPhone" }
    },
    "active_instance_id": "tab-uuid-1"
  }
}
```

This allows the PlaybackTargetMenu to list specific instances as transfer
targets, labeled as "Chrome on macOS (Tab 1)" or using `device_label +
instance_index` when multiple instances share a device.

#### Redis Pub/Sub Cleanup for Dead Instances

#### Volume bidirectional sync

- **Software volume change** (user drags slider on controller): Controller sends
  `update_volume`. Server pushes to active device. Active device applies it.
- **Hardware volume change** (user presses volume button on keyboard/phone):
  Active device sends `update_volume`. Server broadcasts to all controllers so
  their UI sliders stay in sync.

## Server Implementation

### File Structure (new files only, v1 files marked for deletion)

```text
app/crate/api/connect_ws.py              # NEW: WebSocket endpoint + hub
app/crate/api/schemas/connect_ws.py      # NEW: WS message schemas + ws-ticket schema
app/crate/db/repositories/connect_state.py  # NEW: PlayerState CRUD (Redis + PG flush)
app/crate/db/repositories/connect_ws_hub.py # NEW: WebSocket connection manager (multi-worker via Redis Pub/Sub)
app/crate/db/repositories/connect_ws_tickets.py  # NEW: short-lived WS ticket creation/validation

# Files to KEEP (v1, with modifications)
app/crate/api/playback_state.py          # KEEP: device registry, resume candidate
app/crate/api/schemas/playback_state.py  # KEEP: device/resume schemas
app/crate/db/repositories/playback_state.py # KEEP: upsert_device, list_devices, resume
app/crate/db/migrations/versions/035_crate_connect_foundation.py  # KEEP
app/crate/db/migrations/versions/037_crate_connect_active_sessions.py  # KEEP
app/crate/db/migrations/versions/043_user_connect_preferences.py  # KEEP

# Files to DELETE (or archive)
app/crate/api/connect.py                 # DELETE: replaced by connect_ws.py
app/crate/api/schemas/connect.py         # DELETE: replaced by connect_ws.py schemas
app/crate/db/repositories/connect.py     # DELETE: ~1100 lines, replaced by connect_state.py
app/crate/db/migrations/versions/040_connect_command_outbox.py  # DELETE/DROP TABLE
```

### `connect_ws_hub.py` — WebSocket Connection Manager (Multi-Worker)

In production, multiple uvicorn workers handle requests. An in-memory dict
can't route messages between connections on different workers. v2 uses
**Redis Pub/Sub for cross-worker fanout**:

```python
class ConnectHub:
    """
    Local connection registry + Redis Pub/Sub fanout.

    Each worker process maintains its own _connections dict for connections
    it owns. To send to a connection on another worker, it publishes to
    Redis Pub/Sub channel connect:fanout:{user_id}. Every worker subscribes
    to fanout channels for its connected users and forwards messages to its
    local connections.

    For dev (single worker), Redis Pub/Sub can be bypassed and messages
    delivered directly — the interface is the same.
    """
    _connections: dict[int, dict[str, WebSocket]]  # user_id -> {instance_id -> ws}
    _pubsub: Redis | None                          # Redis Pub/Sub client (or None in dev)

    async def connect(self, user_id: int, instance_id: str, ws: WebSocket) -> None:
        """Register connection locally. Subscribe to fanout channel if first for user."""
        ...

    async def disconnect(self, user_id: int, instance_id: str) -> None:
        """Remove connection. Unsubscribe if last for user."""
        ...

    async def send_to_instance(self, user_id: int, instance_id: str, message: dict) -> bool:
        """
        Try local delivery first. If instance is connected to this worker,
        send directly. Otherwise, publish to Redis Pub/Sub fanout.
        Returns True if the instance was found locally and message sent.
        """
        ...

    async def broadcast_to_user(self, user_id: int, message: dict, *, exclude_instance: str | None = None) -> None:
        """
        Send to ALL connected instances for this user.
        Local connections get direct send. Also publishes to Redis Pub/Sub
        so other workers deliver to their connections.
        """
        ...

    def get_connected_instances(self, user_id: int) -> set[str]:
        """Known local instances. For full list, query Redis."""
        ...
```

Redis Pub/Sub channel per user:

```
connect:fanout:{user_id}
```

Message format published to Redis:

```json
{
  "target_instance_id": "tab-uuid-xyz",
  "exclude_instance": null,
  "message": { "type": "transfer_incoming", "payload": {...} }
}
```

- `target_instance_id` = `null` → deliver to ALL local instances (broadcast).
- `target_instance_id` = specific UUID → deliver only to that instance.

Each worker, on receiving a Pub/Sub message for `connect:fanout:{user_id}`:
1. If `target_instance_id` is set: look up in local `_connections`, send if found.
2. If `target_instance_id` is null: iterate all local connections for this user,
   skip `exclude_instance`, send to each.

**Dev mode** (single worker, `CRATE_DEV=1`): hub operates in direct mode —
skips Redis Pub/Sub entirely. Uses `asyncio.Lock` per user_id for thread safety.

### `connect_state.py` — PlayerState Repository

```python
async def get_player_state(user_id: int) -> dict | None:
    """Read PlayerState from Redis. Fall back to Postgres if Redis miss."""
    ...

async def update_player_state(
    user_id: int,
    updates: dict,
    expected_version: int,
) -> dict:
    """
    Atomic update with version check.
    Uses Redis WATCH/MULTI/EXEC for optimistic locking.
    Increments version. Returns new full state.
    Raises ConnectStaleState if expected_version != current.
    """
    ...

async def begin_transfer(user_id: int, transfer_id: str, hub: ConnectHub) -> dict:
    """
    Freeze position, set transfer_state="pending", push transfer_incoming to target.
    Returns { state, transfer_deadline }.
    """
    ...

async def commit_transfer(user_id: int, transfer_id: str, hub: ConnectHub) -> dict:
    """
    Atomically switch active_instance_id to target.
    Push transfer_committed to target, became_inactive to source.
    Broadcast player_state_update.
    """
    ...

async def cancel_transfer(user_id: int, transfer_id: str, reason: str, hub: ConnectHub) -> None:
    """
    Revert transfer_state to null. Push transfer_failed to source and target.
    Source remains active.
    """
    ...

async def flush_player_state_to_postgres(user_id: int) -> None:
    """Persist current Redis PlayerState to user_active_playback_sessions + user_playback_device_states."""
    ...

async def handle_transfer_timeout(user_id: int, transfer_id: str, hub: ConnectHub) -> None:
    """
    Called by asyncio task after 10s deadline.
    If transfer_state is still "pending" with this transfer_id, cancels it.
    """
    ...
```

### `connect_ws_tickets.py` — WS Ticket Repository

```python
async def create_ws_ticket(user_id: int, device_id: str) -> dict:
    """
    Create an HMAC-SHA256 signed ticket: payload{v2,user_id,device_id,expires_at}.hmac
    Returns { ticket, expires_at, ws_url }.
    TTL: 60s. One-time use.
    """
    ...

async def validate_ws_ticket(ticket: str) -> dict | None:
    """
    Verify HMAC signature, check expiry, check not already used (Redis SET NX).
    Returns { user_id, device_id } or None.
    Invalidates ticket after first use.
    """
    ...
```

### `connect_ws.py` — WebSocket Endpoint + Ticket Endpoint

```python
@router.post("/api/me/connect/ws-ticket", response_model=WsTicketResponse)
def create_ws_ticket_endpoint(request: Request, body: WsTicketRequest):
    user_id = _require_persisted_user_id(request)
    ticket = await create_ws_ticket(user_id, body.device_id)
    return ticket


@router.websocket("/api/me/connect/ws")
async def connect_websocket(ws: WebSocket, ticket: str = Query(...)):
    # Validate ticket (one-time use, 60s TTL)
    ticket_data = await validate_ws_ticket(ticket)
    if not ticket_data:
        await ws.close(code=4001, reason="Invalid or expired ticket")
        return

    user_id = ticket_data["user_id"]
    persistent_device_id = ticket_data["device_id"]

    await ws.accept()

    # Send server hello
    server_time = datetime.now(timezone.utc).isoformat()
    await ws.send_json({"type": "hello", "payload": {
        "user_id": user_id,
        "server_time": server_time,
    }})

    # Wait for client hello (timeout 5s)
    try:
        raw = await asyncio.wait_for(ws.receive_json(), timeout=5.0)
    except asyncio.TimeoutError:
        await ws.close(code=4002, reason="Hello timeout")
        return

    client_hello = ConnectHelloMessage(**raw)
    if client_hello.type != "hello":
        await ws.close(code=4003, reason="Expected hello message")
        return

    instance_id = client_hello.payload["playback_instance_id"]

    # Validate persistent device_id in hello matches the ticket
    if client_hello.payload.get("device_id") != persistent_device_id:
        await ws.close(code=4004, reason="Device ID mismatch")
        return

    # Register instance in hub
    await hub.connect(user_id, instance_id, ws)

    # Upsert device in user_devices
    await upsert_device(user_id, device_id=persistent_device_id, ...)

    # Mark presence
    await mark_device_present(user_id, device_id=persistent_device_id, ...)

    # Send initial PlayerState
    state = await get_player_state(user_id)
    if state:
        await ws.send_json({
            "type": "player_state",
            "payload": state,
            "version": state["version"]
        })

    try:
        while True:
            raw = await ws.receive_json()
            msg = ConnectMessage(**raw)
            await handle_message(user_id, instance_id, persistent_device_id, msg, hub)
    except WebSocketDisconnect:
        await hub.disconnect(user_id, instance_id)
```

### Message handler (dispatch table)

```python
HANDLERS = {
    "hello": handle_hello,
    "claim_active": handle_claim_active,
    "transfer_request": handle_transfer_request,
    "transfer_ready": handle_transfer_ready,
    "transfer_cancel": handle_transfer_cancel,
    "update_position": handle_update_position,
    "update_status": handle_update_status,
    "update_queue": handle_update_queue,
    "update_volume": handle_update_volume,
    "update_shuffle": handle_update_shuffle,
    "update_repeat": handle_update_repeat,
    "seek": handle_seek,
    "next_track": handle_next_track,
    "previous_track": handle_previous_track,
    "pause": handle_pause,
    "resume": handle_resume,
    "heartbeat": handle_heartbeat,
}

async def handle_message(user_id, instance_id, device_id, msg, hub):
    handler = HANDLERS.get(msg.type)
    if not handler:
        await hub.send_to_instance(user_id, instance_id, {
            "type": "error",
            "payload": {"code": "unknown_type", "message": f"Unknown message type: {msg.type}"}
        })
        return
    await handler(user_id, instance_id, device_id, msg, hub)
```

All handler functions receive `(user_id, instance_id, device_id, msg, hub)`.
`instance_id` is the playback instance UUID. `device_id` is the persistent
device UUID (used for device registry updates).

### Commands Allowed/Rejected During Pending Transfer

While `transfer_state === "pending"`, the server rejects the following messages
for the user with `error { code: "transfer_pending" }`:

| Rejected | Reason |
|---|---|
| `claim_active` | Would race with transfer ownership |
| `update_queue` | Queue may change during handoff |
| `update_shuffle`, `update_repeat` | Structural changes during handoff |
| `seek`, `next_track`, `previous_track` | Would change position/track mid-handoff |
| `update_position` | Position is frozen during transfer |

| Allowed | Reason |
|---|---|
| `transfer_ready` | Required to complete handoff |
| `transfer_cancel` | Required to abort handoff |
| `heartbeat` | Keepalive |
| `update_volume` | Safe; doesn't affect transfer state |

**Exception — `claim_active` from the source instance during transfer:**

The source instance (the one that initiated the transfer) is still the active
player until `transfer_committed`. If the user on the source presses play while
transfer is pending, the server cancels the transfer and accepts the claim:

1. Receive `claim_active` from source instance while `transfer_state === "pending"`.
2. Cancel transfer: set `transfer_state = null`, clear `transfer_id` and
   `transfer_deadline` in Redis.
3. Push `transfer_failed { reason: "source-claimed" }` to target.
4. Accept `claim_active` normally — source resumes ownership.

This prevents a deadlock where the user wants to keep listening on the current
device but the UI is stuck in "transferring..." limbo.

**Exception — `update_status` from source during transfer:**

The source instance remains the active player until `transfer_committed`.
`update_status` (play/pause/stop) from the source is accepted normally during
transfer — the source user can continue listening while the target preloads.
`update_status` from non-source instances is rejected as usual (they're not
the active player).

`update_position` from the source instance is also accepted during transfer and
updates the frozen `position_ms` snapshot used for handoff. `update_position`
from non-source instances is rejected as usual.

### Interpolation Scope: Observers Only

Server-anchored position interpolation (defined above in "Position
Interpolation") applies **only to observer instances** (not the active player).
The active player uses its own audio engine's real time. Observable behavior:

- Active instance: shows `currentTime` from the audio engine (native).
- Observer instance: shows interpolated position from server-anchored formula.
- On each `player_state_update` from the active instance, the observer resets
  its interpolation anchor to the new `position_ms` + `position_updated_at`.

#### Redis Pub/Sub Cleanup for Dead Instances

Each worker subscribes to `connect:fanout:{user_id}` when the first instance
for that user connects, and unsubscribes when the last instance disconnects.
To prevent leaked subscriptions from crashed workers:

1. **Connection tracking in Redis**: on connect, `SADD connect:ws:workers:{user_id} {worker_id}`.
   On disconnect of last instance, `SREM` + `UNSUBSCRIBE`.
2. **Periodic cleanup** (every 60s): each worker scans
   `connect:ws:workers:{user_id}` sets. If a worker_id has no corresponding
   process alive (checked via a per-worker heartbeat key
   `connect:ws:worker:{worker_id}` with 30s TTL, renewed every 15s), the
   dead worker is removed from the tracking set.
3. **WebSocket ping/pong**: server sends WebSocket ping every 30s. If no
   pong within 10s, the connection is considered dead, cleaned up, and
   `connected_instances` is re-broadcast.

### WS Ticket Implementation Detail

Ticket format: `v2.{base64url(json_payload)}.{base64url(hmac_sha256)}`

JSON payload:
```json
{
  "user_id": 1,
  "device_id": "chrome-desktop-uuid",
  "jti": "unique-ticket-id-uuid",
  "exp": 1717160460
}
```

Validation:
1. Split by `.` → 3 parts.
2. Verify HMAC-SHA256 signature using server secret.
3. Check `exp` is in the future (60s window).
4. `SET NX connect:ws:ticket:{jti} 1 EX 60` (one-time use).
   If SET NX returns null → ticket already consumed → reject.
5. Extract `user_id`, `device_id` from payload.

The `jti` (JWT ID / ticket nonce) ensures even if the HMAC payload is replayed
within the 60s window, the ticket can only be used once.

## Frontend Implementation

### File Structure

```text
app/listen/src/lib/crate-connect.ts                     # REWRITE: simpler, WS-based
app/listen/src/contexts/use-crate-connect-ws.ts         # NEW: 1 hook to rule them all
app/listen/src/components/player/ContinuePlaybackPrompt.tsx  # KEEP: minor tweaks
app/listen/src/components/player/PlaybackTargetMenu.tsx      # KEEP: minor tweaks
app/listen/src/lib/playback-targets.ts                  # KEEP: minor tweaks

# Files to DELETE
app/listen/src/contexts/use-crate-connect-commands.ts   # DELETE: replaced by WS
app/listen/src/contexts/use-remote-playback-state.ts    # DELETE: merged into WS hook
app/listen/src/lib/remote-playback-state.ts             # KEEP: payload builders still useful
app/listen/src/hooks/use-crate-connect-enabled.ts       # SIMPLIFY: just reads feature flag
```

### `crate-connect.ts` (rewritten)

Drops all v1 functions (`acknowledgeConnectCommand`, `fetchPendingConnectCommands`,
`connectCommandEventsUrl`, `sendConnectCommand`, `transferPlaybackToDevice`,
`emitConnectSessionChanged`, `CONNECT_SESSION_EVENT`).

New exports:

```typescript
export function generatePlaybackInstanceId(): string  // crypto.randomUUID(), called on mount
export async function fetchWsTicket(): Promise<{ ticket: string; ws_url: string }>
export function connectWebSocketUrl(ticket: string): string  // absolute ws:// URL
export type ConnectMessage = { type: string; payload: Record<string, unknown>; version?: number }
export type PlayerState = { /* ... */ }
```
### `useCrateConnectWs()` — 1 hook, replaces 3

This single hook replaces `useCrateConnectCommands`, `useRemotePlaybackState`,
and the PlayerBar's `refreshConnectSession` polling.

```typescript
interface UseCrateConnectWsOptions {
  authUser: AuthUser | null;
  enabled: boolean;
  deviceId: string;                    // Persistent device UUID (from localStorage)
  deviceLabel: string;
  // Player state refs
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  // ... other refs
  // Handlers
  onTransferIncoming: (state: PlayerState) => Promise<boolean>;
  onTransferCommitted: () => void;
  onTransferFailed: (reason: string) => void;
  onBecameInactive: () => void;
  onRemoteSeek: (positionMs: number) => void;
  onRemoteNext: () => void;
  onRemotePrevious: () => void;
  onRemotePause: () => void;
  onRemoteResume: () => void;
  onRemoteVolume: (volume: number) => void;
  pause: () => void;
}

interface UseCrateConnectWsResult {
  activeSession: PlayerState | null;
  isRemoteActive: boolean;
  activeDeviceLabel: string | null;
  remotePosition: number;            // Server-anchored interpolated position
  remoteDuration: number;
  remoteVolume: number;
  sendPosition: () => void;
  sendVolume: (v: number) => void;
  claimActive: (positionMs: number) => Promise<void>;
  requestTransfer: (targetInstanceId: string) => Promise<void>;
  seekTo: (positionMs: number) => void;
  nextTrack: () => void;
  previousTrack: () => void;
  pauseRemote: () => void;
  resumeRemote: () => void;
}
```

**Lifecycle:**

1. On mount (auth + enabled):
   - Generate `playbackInstanceId = crypto.randomUUID()` (stored in `useRef`).
   - `fetchWsTicket()` → `POST /api/me/connect/ws-ticket`.
   - Open `new WebSocket(ws_url)`.
   - Receive server `hello` → compute `serverClockOffset = server_time - Date.now()`.
   - Send client `hello` with `{ device_id, playback_instance_id, device_label, ... }`.
   - Receive `player_state` → set `activeSession`, determine `isRemoteActive`.
2. On `transfer_incoming`:
   - Call `onTransferIncoming(state)` — load queue, resolve tracks, push to engine
     with `autoplay: false`, seek to position.
   - If successful: send `transfer_ready { transfer_id }`.
   - If failed: send `transfer_cancel { transfer_id, reason }`.
3. On `transfer_committed`:
   - Call `onTransferCommitted()` — start playback.
   - Send `update_status { status: "playing" }` and `update_position` to confirm.
   - **Does NOT send `claim_active`** — server already committed ownership.
4. On `transfer_failed`:
   - Call `onTransferFailed(reason)` — cleanup preloaded state.
5. On `became_inactive`: call `onBecameInactive()` — pause local.
6. On `player_state_update`:
   - Update `activeSession`, `remoteVolume`, etc.
   - Compute `remotePosition` using interpolation formula (see Position
     Interpolation above).
7. Every 5s while this instance is active: `sendPosition()`.
8. On user action (play/pause): `claimActive()` / `update_status`.
9. On user action (transfer): `requestTransfer(targetInstanceId)`.
10. On pagehide: send final position + close WS gracefully.
11. On disconnect: reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s).
    Re-fetch ticket on each reconnect (tickets are one-time use).

### PlayerBar changes

Remove:
- `refreshConnectSession` (polling every 2.5s)
- `CONNECT_SESSION_EVENT` listener
- `sendRemoteTransportCommand` (all command dispatch)
- `optimisticRemoteTime` / `optimisticRemoteVolume` (WS provides server-anchored values)
- `remoteClockTick` interval (position interpolation is computed from server clock)

Replace with:
- `useCrateConnectWs()` hook result
- `isRemoteActive` — controls transport interception
- `remotePosition` — server-anchored interpolated position
- `remoteVolume` — live from WS
- `claimActive()`, `requestTransfer()`, `seekTo()`, `nextTrack()`, `previousTrack()` — call WS hook directly

The PlayerBar's `handlePlayPause`, `handleSeek`, `handleNextTrack`, etc. remain
structurally identical — they just call WS hook methods instead of
`sendRemoteTransportCommand`.

## Database Changes

### PostgreSQL — Tables kept (no schema migration required)

- `user_devices` — device registry, same schema. Contains persistent
  `device_id` (UUID from localStorage), `device_label`, capabilities, etc.
- `user_playback_device_states` — durable playback checkpoints per device.
  Same schema. Persisted on pause/stop/transfer/30s interval/pagehide.
- `user_active_playback_sessions` — PlayerState persistence. Same schema.
  **Semantic change**: the `active_device_id` column will now store
  `playback_instance_id` (per-tab UUID), not the persistent `device_id`.
  The persistent `device_id` is retrieved from `user_devices` when needed
  for display. No column rename — the existing column is reused.
- `users.crate_connect_enabled` — feature flag column, unchanged.

### PostgreSQL — Table dropped

- `connect_command_outbox` — entire table. Commands go through WebSocket.
  Migration 045: `DROP TABLE IF EXISTS connect_command_outbox;`

### Redis — New keys (hot PlayerState + infra)

The PlayerState in Redis has new fields not present in the PostgreSQL
`user_active_playback_sessions` table:

| Field | Persisted to PG? | Purpose |
|---|---|---|
| `active_instance_id` | Yes (in `active_device_id` column) | Per-tab UUID of the active player |
| `active_device_id` | Yes (inferred from `user_devices`) | Persistent device UUID for display |
| `active_device_label` | Yes (inferred) | Human label for display |
| `transfer_state` | No (ephemeral) | `null` / `"pending"` / `"committed"` |
| `transfer_id` | No (ephemeral) | UUID of the active transfer |
| `transfer_deadline` | No (ephemeral) | Server timestamp for 10s timeout |
| `position_ms` | Yes | Current playback position |
| `position_updated_at` | Yes | Server clock when position was recorded |
| `version` | Yes (as `command_seq`) | Monotonic version counter |

Ephemeral transfer fields (`transfer_state`, `transfer_id`, `transfer_deadline`)
live only in Redis and are cleared on transfer completion/failure. They are
never persisted to PostgreSQL — if the server restarts during a transfer, the
transfer is abandoned and clients reconnect cleanly.

Redis keys:

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `playerstate:{user_id}` | JSON string | 24h | Hot PlayerState with all fields above |
| `playerstate:version:{user_id}` | String (int) | 24h | Version counter for optimistic locking |
| `connect:fanout:{user_id}` | Pub/Sub channel | — | Cross-worker WebSocket message fanout |
| `connect:ws:ticket:{jti}` | String (SET NX) | 60s | One-time-use WS ticket enforcement |
| `connect:presence:{user_id}:{device_id}` | String | 90s | Device presence (existing, kept) |
| `connect:ws:instances:{user_id}` | Set | Session | Active instance IDs tracked by hub |
| `connect:ws:workers:{user_id}` | Set | Session | Worker IDs handling user connections |

### `user_active_playback_sessions` flush mapping

When PlayerState is flushed to PostgreSQL (pause/stop/transfer/30s/pagehide):

| Redis field | PostgreSQL column |
|---|---|
| `session_id` | `playback_session_id` |
| `active_instance_id` | `active_device_id` (reused — stores instance UUID) |
| `status` | `status` |
| `version` | `command_seq` |
| `queue_revision` | `state_revision` |
| `updated_at` | `updated_at` |
| `expires_at` | `expires_at` (now + 300s) |

Full queue/track metadata goes to `user_playback_device_states` for the
active device (identified by instance → device lookup via hub).

## API Surface Changes

### Removed endpoints (v1)

| Endpoint | Replacement |
|---|---|
| `POST /api/me/connect/transfer` | WS `transfer` message |
| `POST /api/me/connect/commands` | WS `seek` / `next_track` / `previous_track` messages |
| `GET /api/me/connect/commands` | Not needed (WS push) |
| `GET /api/me/connect/events` (SSE) | WS connection |
| `POST /api/me/connect/commands/{id}/ack` | Not needed (no command/ack model) |
| `GET /api/me/connect/session` | WS `player_state` message |

### Kept endpoints

| Endpoint | Purpose |
|---|---|
| `PUT /api/me/devices/current` | Device registration |
| `POST /api/me/devices/current/presence` | Heartbeat |
| `GET /api/me/devices` | List devices |
| `DELETE /api/me/devices/{id}` | Forget device |
| `PUT /api/me/playback-state/current` | Durable checkpoint (used on pause/stop/pagehide) |
| `GET /api/me/playback-state/resume` | Resume candidate |
| `DELETE /api/me/playback-state/current` | Clear checkpoint |
| `GET /api/me/connect/preferences` | Feature flag |
| `PUT /api/me/connect/preferences` | Feature flag toggle |

### New endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/me/connect/ws-ticket` | Issue one-time WebSocket ticket (60s TTL, bound to user + device) |
| `WS /api/me/connect/ws?ticket=...` | WebSocket for all real-time Connect operations |

## Migration Strategy

### Phase 0: Preparation (1 day)

1. **Add WebSocket endpoint** alongside existing v1 endpoints.
2. **Add `useCrateConnectWs()` hook** alongside existing hooks.
3. Both v1 and v2 systems coexist — feature flag gates which one is active.
4. Write unit tests for `ConnectHub`, `connect_state.py`, WS message handler.

Acceptance:
- WebSocket connects, receives initial PlayerState.
- `claim_active` and `transfer` work in isolation (tested with 2 browser tabs).

### Phase 1: Core Transport (2 days)

1. Implement all WS message handlers (server-side).
2. Implement `useCrateConnectWs()` with full lifecycle.
3. Integrate with PlayerContext: replace `useCrateConnectCommands` +
   `useRemotePlaybackState` with the new hook.
4. Add `transfer_incoming` → `transfer_committed` / `became_inactive` handling in the audio engine
   (pause on inactive, preload + play on transfer).
5. Wire up position heartbeat (every 5s from active device).
6. Wire up volume bidirectional sync.

Acceptance:
- Two browser tabs: one plays, the other sees live position + track updates.
- Pressing play on tab B pauses tab A (via `became_inactive`).
- Transfer from tab A to tab B: queue, position, and playback state transfer.
- Volume slider on tab A changes tab B's volume (if tab B is active).

### Phase 2: Remote Control (1 day)

1. Wire `seek`, `next_track`, `previous_track`, `pause`, `resume` commands via WS.
2. Update PlayerBar to use WS hook methods for remote control
   (`seekTo`, `nextTrack`, `previousTrack`, `pauseRemote`, `resumeRemote`).
3. Remove `sendRemoteTransportCommand`, all command dispatch code.

Acceptance:
- Tab A (controller) can seek/pause/skip on Tab B (active player).
- Tab A's UI reflects Tab B's actual position (updated via WS).

### Phase 3: Resilience (1 day)

1. WebSocket reconnection with exponential backoff.
2. On reconnect: fetch full PlayerState, diff with local, reconcile.
3. Position flush on pagehide/beforeunload.
4. Postgres flush on pause/stop/transfer/30s interval.
5. Handle edge case: device goes offline mid-playback, another device claims active.

Acceptance:
- Kill browser tab, reopen: state restored from Postgres.
- Network drop for 10s: reconnects, state reconciles correctly.
- Two devices try to claim_active simultaneously: version check rejects stale one.

### Phase 4: Remove v1 (0.5 days)

1. Set feature flag to use `v2` in `crate-connect.ts`.
2. Run migration to drop `connect_command_outbox`.
3. Archive v1 files (`connect.py`, `connect.py` schemas, `connect.py` repository).
4. Remove v1 hooks and dead code from frontend.
5. Run full test suite, manual smoke test with 2+ devices.

Acceptance:
- All v1 tests archived or adapted.
- Zero references to `connect_command_outbox`, `read_connect_commands`,
  `acknowledge_connect_command`, `send_connect_command`, `enqueue_connect_command`.
- Cross-device transfer works end-to-end.

### Phase 5: Polish (1 day)

1. Show "Active on [device]" badge in PlaybackTargetMenu (already built, just wire to WS).
2. ContinuePlaybackPrompt: check PlayerState on mount instead of
   `GET /api/me/playback-state/resume` polling.
3. Settings > Connect Devices: list devices with "Online" / "Active" from WS presence.
4. Admin debug panel: show active WebSocket connections per user.

Acceptance:
- UX feels coherent: one output picker, live device status, correct "now playing" display
  on all connected devices.
- No polling anywhere in the Connect code path.

## Performance Model

### WebSocket overhead

- 1 WS connection per **playback instance** (tab/mount), not per device.
  A user with 2 browser tabs + 1 phone = 3 connections.
- Messages: ~200 bytes (JSON) per position update (every 5s per active instance).
- At 3 instances per user, 30 users: ~90 connections. Negligible for FastAPI/uvicorn.
- Redis Pub/Sub channels: 1 per active user (`connect:fanout:{user_id}`).
  At 30 concurrent users: 30 channels. Negligible.

### Redis ops

- `GET playerstate:{user_id}`: on every WS connect, every 5s position update.
- `WATCH/MULTI/EXEC` (optimistic lock): on claim_active, transfer, queue changes.
- `SETEX` for presence keys: every 30s per device.

All Redis ops are O(1). No streams, no lists, no scanning.

### Postgres ops

- No writes during normal playback (position updates go to Redis only).
- Writes on: pause, stop, transfer, 30s interval, pagehide.
- Max write rate: ~2 writes/min/active-user.

## Security

- **WS ticket, not JWT in URL**: Tickets are short-lived (60s), single-use (Redis
  SET NX consumed on validation), and bound to `(user_id, device_id)`. No JWT
  leaks in server logs, proxy logs, or browser history.
- WebSocket auth: ticket validation on connect. After validation, the ticket is
  consumed and cannot be reused.
- Messages validated: `instance_id` + `device_id` must match the WebSocket's
  authenticated identity (from client `hello`).
- `active_instance_id` validated: must exist in hub for this user.
- `transfer_request` validated: target instance must be connected, must belong to
  same user.
- `version` check prevents stale writes from clients with outdated state (no
  `playback_session_id` gymnastics needed).
- No stream URLs, no JWTs, no secrets in PlayerState payloads.
- Queue snapshots use compact track references (same as v1, already sanitized
  in `playback_state.py`).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| WebSocket disconnects under load | Exponential backoff reconnection, position flush on disconnect, fresh ticket per reconnect |
| Redis becomes unavailable | Fall back to Postgres reads for PlayerState. Dev mode skips Redis Pub/Sub entirely. |
| Version counter race (2 concurrent mutations) | Redis WATCH/MULTI/EXEC provides atomic CAS |
| Mobile app background kills WS | Capacitor handles this natively; on resume, reconnect and fetch state |
| Two browser tabs with same device_id | Each tab generates unique `playback_instance_id`. Active session tracks instance, not device. |
| Transfer target never acks | 10s timeout → `transfer_failed` → source stays active. No gap of silence. |
| Cross-worker WS message delivery | Redis Pub/Sub fanout per user_id channel. Dev mode: direct delivery (single worker). |
| WS ticket replay attack | One-time use (Redis SET NX consumed on validation) + 60s TTL |

## Total Estimate

| Phase | Days | Work |
|---|---|---|
| 0 | 1.5 | WS ticket endpoint + hub (with Redis Pub/Sub) + hello handshake + basic hook, tests |
| 1 | 2 | Core transport: all messages, 3-phase transfer, PlayerContext integration |
| 2 | 1 | Remote control: seek/next/prev/pause/resume via WS, server-anchored position interpolation |
| 3 | 1 | Resilience: reconnect with fresh tickets, edge cases, PG flush |
| 4 | 0.5 | Remove v1, drop `connect_command_outbox`, test suite |
| 5 | 1 | Polish: UI integration, instance listing, admin debug |
| **Total** | **7 days** | |

Compared to v1 which took 4+ phases over weeks and still doesn't work reliably.
