---
title: "Sharing a collection without giving away its ownership"
description: "Listen offered Edit on other people's playlists. Explicit viewer roles separated ownership, collaboration, following and copying."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 24
related: [one-library-more-than-one-listener, giving-every-album-a-stable-address, giving-database-writes-a-transaction-boundary]
tags: [How to dismantle Spotify, collaboration, permissions, playlists, history]
sources:
  - docs/technical/playlist-crate-collaboration.md
  - app/crate/db/repositories/playlists_membership_reads.py
  - app/crate/db/repositories/playlists_collaboration.py
  - app/crate/db/repositories/playlists_library_reads.py
  - app/crate/db/repositories/crates_collaboration.py
  - app/crate/db/schema_sections/collaboration_v108.py
  - app/listen/src/lib/collaboration-access.ts
  - app/tests/test_playlist_access.py
  - app/tests/test_collaboration_visibility_migration.py
---

_Part 24. Making ownership visible in playlists and Crates, October 2026._

Open somebody else's public playlist and Listen offered Edit and Delete. Edit the name, save it,
and the API returned 403. The server knew the playlist was not yours. The screen had already invited
you to treat it as if it was.

The problem was visible in a small piece of UI code. Whenever playlist data existed, the action
builder supplied edit and delete callbacks. Elsewhere, ownership was inferred from a member row
with an `owner` role. The response had no single viewer-access field for those surfaces to use.
[Unconditional playlist edit and delete actions](https://github.com/thecrateapp/crate/blob/3bd26c24d6cd369c4a40ff985d2c7906e4551b0c/app/listen/src/pages/playlist-actions.ts#L374-L379), [Ownership inferred from members](https://github.com/thecrateapp/crate/blob/3bd26c24d6cd369c4a40ff985d2c7906e4551b0c/app/listen/src/pages/use-playlist-page-controller.ts#L117-L123).

There was another missing action: a listener could follow a system-generated playlist, but not an
ordinary public playlist made by another person. The interface offered changes that would fail and
omitted the relationship that would actually be useful.

We brought playlists and album-based Crates under the same user-facing model: one owner, optional
collaborators, people who follow the original, and people who make their own copy. The work involved
API payloads, permission checks, a data migration and the library page. Changing two menu items would
have left each of those surfaces guessing independently.

## One collection, different menus

A public playlist is something another listener can discover and play. That does not grant them
permission to edit it. Following keeps a reference to the original, so later changes remain visible.
Copying creates a separate collection that the new owner can change. Collaboration lets someone
edit the original while leaving its ownership intact.

Crates already had access, follows and a way for members to leave. A Crate groups albums; a playlist
groups tracks. We kept those content models and gave Listen shared helpers for deciding which
actions to show. The writes behind those actions still differed in places, especially when
collaboration was turned off.

The access tests compare one public playlist under three viewer IDs: its owner, a listed member and
someone with no membership. Changing the viewer should change the available actions while leaving
the playlist and its tracks alone. Turning collaboration off adds another case: the member still
exists, but can no longer edit.
[Access matrix cases](https://github.com/thecrateapp/crate/blob/674143c3bffbb682f79a6f703c8e2063abe6132f/app/tests/test_playlist_access.py#L12-L58).

Listen's intended menus followed those relationships:

| Viewer | Edit the original | Manage access or delete | Follow | Make a copy |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | No | Not offered |
| Active collaborator | Yes | No; can leave | No | Not offered |
| Other viewer of a public collection | No | No | Yes | Yes |
| Retained playlist member while collaboration is off | No | No | Only if visibility is public | Only if visibility is public |

The table describes Listen's menus. The API enforces each operation separately; the copy endpoint
accepts some roles whose menus omit it. The retained-member row applies to playlists.

For playlists, the owner is `playlists.user_id`. The legacy owner entry in `playlist_members` is
not a second source of ownership. For Crates, the equivalent field is `owner_id`.

The playlist read helper resolves the viewer against that owner, the collaboration flag and membership:

```python source="app/crate/db/repositories/playlists_membership_reads.py#L86-L106" commit="02d8284d6f95a5d5ea54b438fc7c6108fcf305f0" "is_collaborative"
def get_playlist_access(
    playlist: dict | None, user_id: int | None, *, session: Session | None = None
) -> str:
    """Viewer access: owner, collaborator, public or none."""
    if not playlist:
        return "none"
    if playlist.get("scope") == "system":
        return "public"
    if user_id is not None and playlist.get("user_id") == user_id:
        return "owner"
    if user_id is not None and playlist.get("is_collaborative"):
        member = get_playlist_member(int(playlist["id"]), user_id, session=session)
        if member and member.get("role") in {"owner", "collab"}:
            return "collaborator"
    if playlist.get("visibility") == "public":
        return "public"
    if user_id is not None and get_playlist_member(
        int(playlist["id"]), user_id, session=session
    ):
        return "public"
    return "none"
```

The owner check comes before membership. A collaborative member gets `collaborator`; an ordinary
viewer of a public playlist gets `public`; an unrelated viewer of a private playlist gets `none`.
System playlists keep their own public-access path.

The last membership check is easy to miss. A playlist owner can turn collaboration off without
removing the members. Those people retain read-only access, even if the playlist is private, so the group can be
restored later without adding everyone again.

We report that retained member as `public`. The name is unfortunate: it describes read-only access
here, not public visibility. A private playlist can therefore produce `access: "public"` for a
retained member and `access: "none"` for someone else. Showing Follow from the access string alone
would expose the wrong action again. The client has to check visibility as well.

Crates did not retain the group in this implementation. Updating a Crate with
`is_collaborative=False` deleted its `crate_members` and `crate_invites` rows. Turning collaboration
back on would therefore not restore the previous group. That Crate write path
still behaved differently from the playlist flag update, despite the shared client helpers.
[Crate members removed when collaboration is disabled](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/db/repositories/crates.py#L265-L274).

The detail endpoint attached `access`, `can_edit` and follow state to the response. It returned the
member list only to owners and active collaborators. Ordinary public viewers received an empty
members list, and the dedicated members endpoint rejected their requests.
[Viewer-specific detail payload](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/api/playlists.py#L156-L171), [Public viewer access tests](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/tests/test_playlist_access.py#L110-L152).

Listen then used one small helper module for the shared decisions:

```typescript source="app/listen/src/lib/collaboration-access.ts#L8-L26" commit="06611c302afad7c482bede4426aba98c5bc906ca" "subject.visibility"
export function canEdit(subject: AccessSubject | null | undefined): boolean {
  return subject?.access === "owner" || subject?.access === "collaborator";
}

export function canManage(subject: AccessSubject | null | undefined): boolean {
  return subject?.access === "owner";
}

export function canLeave(subject: AccessSubject | null | undefined): boolean {
  return subject?.access === "collaborator";
}

export function canFollow(subject: AccessSubject | null | undefined): boolean {
  return subject?.access === "public" && subject.visibility === "public";
}

export function canCopy(subject: AccessSubject | null | undefined): boolean {
  return canFollow(subject);
}
```

With no payload, those helpers offer none of the editing actions. A screen loading or receiving a
changed response should not briefly produce an Edit button because its access field is absent.
The playlist page wired `onEdit` through `canEdit()` and `onDelete` through `canManage()`. Crate actions used the
same helpers. [Access-based action wiring](https://github.com/thecrateapp/crate/blob/06611c302afad7c482bede4426aba98c5bc906ca/app/listen/src/pages/playlist-actions.ts#L432-L440).

`canLeave()` also depends on an active collaborator role, so Listen hides Leave when playlist
collaboration is off. The playlist leave operation itself can still remove a retained non-owner
membership: it checks the owner and removes the member without consulting that flag.
[Playlist leave operation](https://github.com/thecrateapp/crate/blob/674143c3bffbb682f79a6f703c8e2063abe6132f/app/crate/db/repositories/playlists_collaboration.py#L40-L49).

The API remained responsible for enforcement. A collaborator could edit content but could not
change visibility, enable collaboration, remove the owner or delete the playlist. Those operations
checked ownership separately. Instance administrators retained their moderation bypass in the
playlist API, while the payload still reported their actual relationship to the playlist. Listen
did not turn every administrator's view into an owner's edit screen.
[Playlist update permissions](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/api/playlists.py#L180-L237).

The frontend tests exercise both access and visibility, including the retained member of a private
playlist and a missing payload. The API tests use the same public playlist as an owner, a
collaborator and another viewer: the public viewer gets an empty member list and a 403 when trying
to inspect members or rename the playlist. These checks cover the declared role combinations;
they do not establish what happens under every concurrent membership change.
[Frontend access matrix](https://github.com/thecrateapp/crate/blob/06611c302afad7c482bede4426aba98c5bc906ca/app/listen/src/lib/collaboration-access.test.ts),
[Playlist access and API tests](https://github.com/thecrateapp/crate/blob/674143c3bffbb682f79a6f703c8e2063abe6132f/app/tests/test_playlist_access.py).

The public viewer now sees Follow and Copy instead of the Edit and Delete callbacks that led to the
original 403.

## Add an editor while keeping one owner

Spotify's documented collaboration workflow distinguishes ordinary playlist use from an
invitation to add, remove and reorder tracks. Its current workflow uses expiring invitation links.
Crate had invite links too, but our collaboration redesign chose direct selection of an account on
the instance. The owner could search for a person, add them and later remove them without managing
a transferable joining link.
[Spotify's collaborative playlist workflow](https://support.spotify.com/us/article/collaborative-playlists/),
[The collaboration problem and intended roles](https://github.com/thecrateapp/crate/blob/06611c302afad7c482bede4426aba98c5bc906ca/docs/technical/playlist-crate-collaboration.md).

The new member endpoint accepted a user ID or username. It authenticated the caller, required the
owner or the playlist API's admin exception, resolved the target account and rejected an attempt to
add the owner as a collaborator. The repository operation then added membership, enabled
collaboration and recorded a domain event in the same transaction scope:

```python source="app/crate/db/repositories/playlists_collaboration.py#L25-L38" commit="77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8" "session=s"
    with optional_scope(session) as s:
        add_playlist_member(
            playlist_id, user_id, role="collab", invited_by=added_by, session=s
        )
        s.execute(
            text("UPDATE playlists SET is_collaborative = TRUE WHERE id = :id"),
            {"id": playlist_id},
        )
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="collaborator_added",
            payload={"user_id": user_id, "added_by": added_by},
        )
```

The membership, collaboration flag and event use the same session, so they commit or roll back
together. A failure after adding the member must not leave that membership behind while the flag
rolls back. The event includes the new member and acting user for downstream consumers. A device
notification still needs a consumer to process and deliver it.
[Owner-managed membership endpoint](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/api/playlists.py#L384-L402).

Leaving was a different operation from deleting. A collaborator could remove their own membership.
The owner could not use Leave to orphan the collection, and another member could not remove the
owner through the member-removal endpoint. The owner remained attached to the collection even when
all collaborators left.
[Leave and remove-member checks](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/api/playlists.py#L405-L415), [owner protection](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/api/playlists.py#L475-L487).

The matching Crate operation inserted `(crate_id, user_id)` with conflict handling, enabled
collaboration and appended `crate.collaborator_added` using the same database session. Album
membership stayed in `crate_albums`; adding a collaborator changed who could edit that list, not
who owned the audio files in the shared library.
[Crate membership transaction](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/db/repositories/crates_collaboration.py#L13-L44).

Direct account selection also needed to close the old joining route. Removing invite controls
from Listen would have left existing links valid. Migration 108 expired outstanding playlist and
Crate invites. The create and accept endpoints returned 410 Gone, while
existing members remained members. Someone who had already joined did not lose access merely
because the joining mechanism changed.

The same migration normalized unsupported or null playlist visibility values to `private`, then
added a check constraint allowing only `private` and `public`. The conservative normalization avoided
interpreting an unknown legacy value as permission to expose a collection.
[Visibility and invite migration](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/db/schema_sections/collaboration_v108.py).

## Follow the original or own a separate list

Following an ordinary public playlist now created a `UserFollowedPlaylist` relationship. The
repository rejected the owner's own playlist and a private user playlist, and a repeated follow
did not create another row. The public detail response carried `is_followed` and `follower_count`.
Unfollow removed that relationship without changing the source playlist.
[Follow persistence](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/db/repositories/playlists_follows.py#L14-L46).

![An owner and a collaborator edit the original collection. A follower keeps a reference to it. Copy creates an independently owned private collection while retaining track or album references.](/blog/sharing-a-collection-without-giving-away-its-ownership/collection-relationships.svg)

The library page had to explain why the original appeared in someone else's library. We separated
owned and shared playlists from followed user playlists and followed system playlists, and showed the owner
on shared entries. The read function reused one database session for those reads and attached owner
names in a batched lookup. It did not make one user query for every card.
[Library reads and owner batching](https://github.com/thecrateapp/crate/blob/674143c3bffbb682f79a6f703c8e2063abe6132f/app/crate/db/repositories/playlists_library_reads.py).

Following a public playlist and later becoming its collaborator initially left two reasons for it
to appear. We excluded member playlists from the followed-user section, so it appeared as shared
rather than twice. If a followed playlist became private and the listener had no membership, it no
longer appeared in that public-followed list. Keeping the follow row did not preserve access to a
now-private playlist.
[Shared/followed regression case](https://github.com/thecrateapp/crate/blob/674143c3bffbb682f79a6f703c8e2063abe6132f/app/tests/test_playlist_access.py#L197-L235).

### A copy has to preserve the stored references

Copy creates another playlist. The first implementation created a private playlist for the viewer,
fetched the source's rendered tracks and fed them through the ordinary add-tracks helper. We then
changed the copy to operate directly on stored playlist rows. A copy should retain every source
reference and its position, including identities that a rendered track payload might not preserve.
[The first playlist copy](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/db/repositories/playlists_collaboration.py#L53-L66).

The copy regression test inserts `Second` at position 2 and
then `First` at position 1. Each row carries an entity UID, a global UID and a path. A correct copy
must preserve those values and return `First`, then `Second`, regardless of insertion order. A new
playlist with the same titles would not establish that its references and order survived.
[Copy references and order regression test](https://github.com/thecrateapp/crate/blob/674143c3bffbb682f79a6f703c8e2063abe6132f/app/tests/test_playlist_access.py#L238-L304).

The corrected insertion copies local IDs, entity IDs, storage IDs, paths and global IDs together:

```sql source="app/crate/db/repositories/playlists_collaboration.py#L64-L75" commit="674143c3bffbb682f79a6f703c8e2063abe6132f" "global_track_uid"
                INSERT INTO playlist_tracks (
                    playlist_id, track_id, track_entity_uid, track_storage_id, track_path,
                    title, artist, album, duration, position, source, locked, added_at,
                    global_track_uid
                )
                SELECT
                    :playlist_id, track_id, track_entity_uid, track_storage_id, track_path,
                    title, artist, album, duration, position, 'manual', FALSE, NOW(),
                    global_track_uid
                FROM playlist_tracks
                WHERE playlist_id = :source_id
                ORDER BY position
```

The new rows receive the new playlist ID, manual provenance, an unlocked state and a new added
timestamp. The playlist belongs to the viewer and starts private. The operation also copies the
source's stored totals and emits a tracks-added event in the same transaction. The regression test
compares the copied references and positions with the source, then checks the new owner, private
visibility, two-track count and total duration.

A Crate copy used the same general approach at album level: create a private Crate, preserve its
ordering settings and copy the `global_album_uid` and position of each entry. Neither copy stayed
subscribed to later edits of the original. That is what Follow was for. [Album-level copy](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/db/repositories/crates_collaboration.py#L47-L71).

The copy endpoint is broader than the menu at the start of this article. Listen offers Copy to
public viewers. The backend copy endpoints accept a viewer with access other than `none`, including an
owner or collaborator. Hiding Copy for those roles is an interface choice, not an authorization
restriction enforced by the server. [Playlist copy access check](https://github.com/thecrateapp/crate/blob/674143c3bffbb682f79a6f703c8e2063abe6132f/app/crate/api/playlists.py#L458-L466), [Crate copy access check](https://github.com/thecrateapp/crate/blob/77ea09d36b0ebe8a9629edb0c820d2c6ce4d7fe8/app/crate/api/crates.py#L579-L584).

The new owner can edit the copied collection independently. The copy does not duplicate the audio
files or grant additional access to a remote source. Both lists can still point at the same track,
so a track becoming unavailable can affect playback in both. Its private visibility and new owner do not change those source permissions.
