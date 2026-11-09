---
title: "From tour dates to a show people can share"
description: "A concert needed an identity beyond its provider listing, so corrections, attendance and reminders could survive syncs and duplicate cleanup."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 26
related: [making-listening-history-belong-to-crate, bringing-purchased-music-into-a-shared-library]
tags: [How to dismantle Spotify, concerts, identity, PostgreSQL, history]
sources:
  - app/crate/db/repositories/show_identities.py
  - app/crate/db/repositories/show_consolidation.py
  - app/crate/db/repositories/shows_attendance.py
  - app/crate/db/repositories/shows_ticketmaster_upserts.py
  - app/crate/db/queries/shows_shared.py
  - app/tests/test_show_identity.py
  - app/tests/test_show_migration.py
---

_Part 26. Turning provider listings into shared concert records, spring–October 2026._

Two people can be going to the same concert while Crate thinks they are attending different shows.
One marks a Ticketmaster listing; the other marks a listing supplied by another source. Both cards
say the same artist, venue and date. Their database IDs are different.

Deduplicating the cards makes the page look better, but it does not move either person's attendance
record. The next provider sync can bring the duplicate back. A manual correction to the venue can
also disappear if a later import blindly replaces the fields.

As shows became something people could act on together, we needed a stable object behind those
cards. The provider's listing would remain useful evidence about the show. It could no longer be
the whole identity of the show.

## Two listings need one identity without losing their evidence

Crate's spring implementation did more than append tour dates. The April Last.fm integration tried
to consolidate a scraped listing with Ticketmaster data using the artist, date and a normalized
venue. It retained selected Ticketmaster fields, added Last.fm information and combined lineups.
That solved a useful part of the overlap between two sources.
[April consolidation implementation](https://github.com/thecrateapp/crate/blob/0635643f6fd0df5e8d9633c7e9457175061625a5/app/crate/db/shows.py).

The underlying model still leaned heavily on provider fields. Before the October identity change,
the Ticketmaster upsert used `external_id` as its conflict key and replaced the show fields with
incoming values. Rows without an external ID followed a separate artist/date/venue lookup.
[Previous provider writer](https://github.com/thecrateapp/crate/blob/f80679eead4e09ba127518b3e9ee62f497148304/app/crate/db/repositories/shows_ticketmaster_upserts.py).

That works well when one provider owns the record. It becomes awkward when a curator corrects the
venue, another source supplies a support act and a third source uses a different headliner for the
same bill. A replacement policy also has to account for the people already attached to the losing row.

### Keep the listing and the show as different things

Ticketmaster's Discovery API v2 exposes events, attractions and venues with their own identifiers.
An event ID is a reliable way to find that provider's event again. It does not supply a common ID
for a manual entry or an unrelated provider's listing.
[Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/).

MusicBrainz makes a related distinction in its event model: the event has an identity and properties
such as dates, start time and cancellation state, rather than being only a row under an artist.
That is a useful comparison for the data model; Crate's October implementation did not import
MusicBrainz event identities or require an MBID to create a show.
[MusicBrainz event model](https://musicbrainz.org/doc/Event).

One option was to pick a preferred provider and let its version win. Another was to merge anything
that looked similar. The first would keep overwriting legitimate corrections. The second could
merge two performances by the same artist at the same venue on the same day.

We kept a local canonical show and attached provider references to it. An alias is a pair of
`provider` and `event_id`, pointing to a Crate show ID:

```python source="app/crate/db/schema_sections/shows_v117.py#L23-L28" commit="02b658a137680ca01322918859eb46061e1f7165" "PRIMARY KEY"
    cur.execute("""CREATE TABLE IF NOT EXISTS show_source_aliases (
        provider TEXT NOT NULL, event_id TEXT NOT NULL,
        show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE RESTRICT,
        evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(provider,event_id))""")
```

The schema also added revisions, field provenance, source evidence, an optional semantic identity
key and `merged_into_id`. Existing provider references were backfilled as aliases. The migration
only assigned a semantic key when that key was unique among existing candidates. It did not resolve
ambiguous historical rows by deleting whichever one happened to come second.
[Schema migration and backfill](https://github.com/thecrateapp/crate/blob/02b658a137680ca01322918859eb46061e1f7165/app/crate/db/schema_sections/shows_v117.py).

![Two provider aliases point to one canonical show with field provenance and a revision. Attendance and reminders attach to that show. An explicitly consolidated duplicate retains a redirect to the canonical ID.](/blog/from-tour-dates-to-a-show-people-can-share/canonical-show.svg)

### Be conservative when there is no exact alias

An existing alias gives the writer a strong identity reference. Without one, it has to compare the
candidate with local shows. The initial October matcher looked at normalized artist and date, then
venue, city, country and time.

Known differences matter. If both sources specify a start time and those times differ, they can
represent separate sessions. Different countries also rule out a match even when venue and city
names happen to be the same. Missing venue information or a similar venue spelling produces a
possible match for review rather than enough confidence for an automatic merge.

The follow-up work expanded the artist comparison to the whole lineup. A bill containing A and B
can be listed under either performer. If the complete performer sets agree, changing the primary
artist does not by itself make it a different event. A partial overlap is weaker evidence and can
require review. The matcher normalizes whitespace and case; it does not claim to understand every
artist alias or venue rename.
[Lineup-aware identity matching](https://github.com/thecrateapp/crate/blob/745f96f0229db0283c1b30957bda849d579bafa4/app/crate/db/repositories/show_identities.py).

This also means an unknown time is not permission to collapse two known sessions. If the candidate
could match both, the result is a conflict with the candidate show IDs. A person has to choose which
session they meant.

The hash stored in `identity_key` helps enforce exact normalized identities. It is not a substitute
for these matching rules. A hash can tell us that two normalized tuples agree; it cannot tell us
whether a missing time meant the afternoon show or the evening one.

Incomplete lineups, venue aliases and unknown session times still produce conflicts. Protecting a
manual correction also protects a mistaken one until someone reviews it again. Provenance records
who supplied the field; it cannot tell us that the doors time is correct.

## Keep a reviewed correction through the next competing write

Suppose a curator corrects the doors time using a venue announcement. The next automated sync may
still carry the old value. A blanket “latest write wins” rule would undo the correction.

Crate stores provenance per field. The initial canonical writer protected fields whose editor was
manual or MCP-driven from later automated provider updates:

```python source="app/crate/db/repositories/show_identities.py#L241-L250" commit="02b658a137680ca01322918859eb46061e1f7165" "protected"
            protected = provenance.get(key, {}).get("provider") in {"manual", "mcp"}
            if existing and (
                (
                    key == "artist_name"
                    and not (manual and candidate.get("existing_show_id"))
                )
                or (protected and not manual)
            ):
                continue
            values[key] = candidate[key]
```

The candidate's external reference and the actor making the change are separate facts. A curator
can cite a Ticketmaster event without turning their correction into a Ticketmaster-authored field.
That distinction became explicit in the later alias handling.

Lineups needed the same care. Automatically unioning names is useful when one source adds a support
act. It is wrong after a curator explicitly removes a performer who will not be appearing. The
refined writer preserves the reviewed lineup against a provider sync that still carries the old
name. Tests exercise both orders: manual creation followed by provider data, and provider creation
followed by a manual correction.
[Correction and provenance tests](https://github.com/thecrateapp/crate/blob/745f96f0229db0283c1b30957bda849d579bafa4/app/tests/test_show_identity.py).

A preview reads the current match and revision without writing. Applying a correction checks the
expected revision. If the show has changed since review, the caller receives a conflict instead of
silently applying a stale decision. The reviewed-import workflow uses this shared writer; it does
not get a separate shortcut around show identity.

We also keep source evidence out of ordinary shared show responses. A curator's private flyer text
or extraction reference is useful during review, but it is not part of the concert card everyone
should receive. The tests check that the shared readers omit that evidence.

### Matching must be repeated after waiting

There was another way to create duplicates: let a provider and a manual import both check for an
existing show before either inserts one. A unique provider alias cannot prevent that when only one
of the candidates has that alias.

The canonical writer acquires transaction advisory locks before matching. The first version used
the primary artist and date. The follow-up expanded those keys to every known performer, so two
sources choosing opposite headliners still contend on shared locks:

```python source="app/crate/db/repositories/show_identities.py#L101-L112" commit="745f96f0229db0283c1b30957bda849d579bafa4"
def _lock_keys(candidate, source):
    # Every performer shares a lock with sources that choose another headliner
    # or omit support acts. A partial lineup still requires review after locking.
    keys = {
        "show:base:" + artist + "|" + str(candidate.get("date") or "")
        for artist in _artist_names(candidate)
    }
    alias = _source_alias(candidate, source)
    if alias:
        keys.add("show:alias:" + alias["provider"] + ":" + alias["event_id"])
        keys.add("show:legacy:" + _legacy_id(alias))
    return keys
```

The caller acquires these keys in sorted order. Matching happens after the locks, and an existing
row is locked before modification. Even then, waiting for a row lock can invalidate a previous
semantic match: someone may have corrected the venue or consolidated the row while the writer
waited. Later fixes recheck that identity and reject a row that now redirects elsewhere.

The concurrency tests deliberately pause competing operations at those boundaries. They cover
simultaneous manual/provider insertion, inverted headliners and a correction or consolidation
between matching and the row lock. These are stronger checks than inserting the same payload twice
in sequence.

## Move the attendance, not just the card

Some duplicates already exist. Automatically hiding one in a reader is especially dangerous here:
the visible card can change while attendance and reminders remain attached to separate IDs.
The canonical change therefore stopped the read-side deduper from merging rows with distinct
non-empty IDs.
[Read-side identity guard](https://github.com/thecrateapp/crate/blob/02b658a137680ca01322918859eb46061e1f7165/app/crate/db/queries/shows_shared.py#L35-L37).

An explicit consolidation selects a canonical row and a bounded set of duplicates, checks the
reviewed revisions and locks the rows. It then transfers their relations. Attendance uses the earliest
existing timestamp when the same user is attached to both records:

```python source="app/crate/db/repositories/show_consolidation.py#L40-L50" commit="745f96f0229db0283c1b30957bda849d579bafa4"
        current.execute(
            text("""INSERT INTO user_show_attendance(user_id,show_id,created_at)
            SELECT user_id,:canonical,min(created_at) FROM user_show_attendance
            WHERE show_id=ANY(:duplicates) GROUP BY user_id
            ON CONFLICT(user_id,show_id) DO UPDATE SET created_at=LEAST(user_show_attendance.created_at,EXCLUDED.created_at)"""),
            params,
        )
        current.execute(
            text("DELETE FROM user_show_attendance WHERE show_id=ANY(:duplicates)"),
            params,
        )
```

Reminders move with their type and trigger information. Aliases and source evidence move to the
canonical show. Duplicate rows remain archived with `merged_into_id`, and later consolidations
flatten older redirects to the new canonical target.

That redirect matters to an action from an old card. Attendance and reminder writers resolve the
canonical ID before mutating relations. A shared advisory lock protects that resolution while
consolidation takes the exclusive counterpart, so a concurrent “I'm going” cannot land on the old
row just after its existing relations have been moved.
[Consolidation](https://github.com/thecrateapp/crate/blob/745f96f0229db0283c1b30957bda849d579bafa4/app/crate/db/repositories/show_consolidation.py),
[attendance and reminder writes](https://github.com/thecrateapp/crate/blob/745f96f0229db0283c1b30957bda849d579bafa4/app/crate/db/repositories/shows_attendance.py).
