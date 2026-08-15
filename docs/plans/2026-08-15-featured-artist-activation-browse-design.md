# Featured artist activation and Browse design

## Objective

Make Artist Hero eligibility explicit and manageable from Admin. Artists shown in
the desktop/mobile Hero are selected from the shared `is_featured` flag, subject
to having an approved composition for the requested device. Browse must expose
that state clearly, support filtering, and default to a stable Recently Added
ordering.

## Product rules

- `is_featured` is one shared artist-level flag for desktop and mobile.
- An artist is eligible only when `is_featured = true` and it has at least one
  approved Hero composition.
- Desktop and mobile candidate queries apply their own approved-composition
  requirement.
- If there are no valid candidates for a device, that device renders no Hero;
  it does not fall back to the legacy carousel or reserve an empty slot.
- Approving a composition does not automatically enable `is_featured`.
- Resetting or deleting a composition removes only that slot's recipe, artifact,
  and approval state; the source image remains in the gallery.
- If the artist loses both approved compositions, the backend atomically forces
  `is_featured = false`.

## Data model and ordering

Add to `library_artists`:

- `is_featured BOOLEAN NOT NULL DEFAULT false`.
- `first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`.

`first_seen_at` is assigned only on artist creation and is preserved by every
resync, enrichment, repair, and metadata update. The central artist upsert must
not overwrite it. Direct insert paths must use the database default or be
migrated to the central upsert.

Existing artists cannot have their original insertion instant reconstructed if
it was never recorded. A migration should backfill deterministically from the
oldest available artist/album filesystem timestamp, falling back to the
current `updated_at`; this limitation should be documented. Values are exact
and immutable for all artists created after the migration.

Browse's default order is:

```sql
ORDER BY first_seen_at DESC, id DESC
```

Explicit alphabetical, popularity, album-count, size, and other existing sorts
remain available. Add an index supporting the default order and a partial index
for featured artists.

## Activation surfaces

The canonical control lives in Admin's Artist > Artwork > Artist Hero section:

- Toggle labelled `Featured artist`.
- Desktop and Mobile readiness indicators.
- Toggle disabled when no approved composition exists, with an explanatory
  message and a link/context to the Hero editor.
- Approved and Featured remain separate statuses so approval never publishes an
  artist accidentally.

Browse provides a secondary quick-management surface using the same backend
command. It may activate or deactivate a single artist; an ineligible artist's
activation action is disabled. No separate management page or bulk operation is
needed in this first slice.

Listen exposes no management controls; it consumes the resulting candidate set.

## Browse contract and UI

`GET /api/artists` returns:

```json
{
  "is_featured": true,
  "featured_devices": ["desktop", "mobile"],
  "first_seen_at": "2026-08-15T10:00:00Z"
}
```

Add `featured=all|true|false` as a URL-persisted filter. The grid and list show
a visible cyan `Featured` badge. Device indicators are shown when useful so an
admin can distinguish a fully prepared artist from one prepared for only one
surface. Filter, sort, and pagination remain shareable through the URL.

Use one administrative endpoint for both editor and Browse:

```text
PATCH /api/artists/{id}/featured
{ "is_featured": true }
```

Enabling validates approved artwork in the same transaction and returns `409`
with a useful reason when the artist is not eligible. Changes invalidate the
artist, Browse, and Home/read-plane snapshots.

## Testing and rollout

Backend tests cover first-seen immutability, migration/backfill behavior,
eligibility validation, automatic flag removal, per-device candidate selection,
Browse filtering, and default ordering. React tests cover the disabled editor
state, toggle behavior, badges, device indicators, filter persistence, and the
recent-sort default.

The migration is backward-compatible because new artists default to
`is_featured = false`. Admin and Listen can be deployed together; no Android
specific change is required beyond consuming the updated Hero read contract.
