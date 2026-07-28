# Listen media-access contract

Listen native clients use the normal bearer token only in HTTP request
headers. Browser primitives that cannot set an `Authorization` header use a
short-lived media-access ticket instead.

## Ticket properties

- Opaque, cryptographically random value stored in Redis only as a SHA-256
  digest.
- Maximum lifetime: 60 seconds.
- Bound to the authenticated user, persisted session, one audience
  (`artwork`, `stream`, `sse` or `ws`) and one exact canonical `/api/...`
  path.
- Query parameters are not part of the authorization identity. The server
  normalizes the requested target to its canonical path before issuance.
- Invalid for every other path, including another path in the same audience.
- Invalid as soon as the backing session is revoked, even if its TTL has not
  elapsed.
- Issued by `POST /api/auth/media-access` using the normal bearer header and a
  bounded `targets` list of at most 128 exact paths.
- Held in memory by Listen. Tickets are never persisted and are scoped to the
  server that issued them.

The route classifier deliberately recognizes only binary media, stream,
event-stream and Jam WebSocket paths. Adding a new path requires a regression
test in `app/tests/test_media_access_tickets.py`; broad API prefixes must not
be authorized.

FastAPI and the Go readplane validate the same SHA-256 Redis key, exact path,
audience and persisted session. Routes served directly by the readplane
therefore preserve the contract instead of falling back to a long-lived query
token. The readplane requires the cache Redis connection even when its SSE
relay is disabled because ticket validation is independent from SSE.

## Client behavior

Listen does not fetch a broad ticket set during bootstrap. Building the first
protected artwork, stream, SSE or WebSocket URL records its exact target and
queues a non-blocking micro-batch. Targets requested in the same microtask are
deduplicated and sent together, with a hard maximum of 128 per request.

When the response arrives, the authenticated tree rebuilds protected media
URLs. Long-lived SSE connections reopen with the fresh ticket. Requested
targets are remembered in bounded in-memory state and renewed every 45
seconds while the app is visible, after credential changes and after server
switches. No ticket is reused across servers or paths.

Generated media URLs remove any legacy `token` parameter before adding the
exact-path `media_ticket`. Absolute URLs are eligible only when they match the
configured server origin and security protocol; external origins never
receive a Crate credential.

Android Media3 does not use tickets for online playback. It receives the
bearer through an HTTP request header and strips credentials from the media
URL. Offline `file:`, `content:` and Capacitor URLs carry neither header nor
ticket.

Same-origin Listen Web continues to use its HTTP-only session cookie, so it
does not need tickets or URL credentials.

## Logging and redaction

Both `token` and `media_ticket` query values are sensitive. Backend and native
playback redactors replace their values before a URL reaches logs, errors or
bridge payloads. Federation and Cast tickets retain their existing,
independent trust contracts.
