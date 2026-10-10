# Playlist and Crate collaboration

One ownership, collaboration and visibility model for user playlists and Crates.

## Problem

A user who opened another user's public playlist saw it as their own: Listen offered Edit and
Delete (the API then rejected the save with 403) and no way to follow it. Playlists exposed no
viewer access level, so every surface guessed from `members`. User playlists could not be
followed at all (follows were limited to system playlists), and collaboration relied on
shareable invite links that do not fit an instance where people already know each other.

Crates already had most of the right model (`access`, follows, member leave). Playlists now
match it.

## Roles and visibility

| Viewer       | See              | Edit content                   | Manage                                      | Follow      | Copy        |
| ------------ | ---------------- | ------------------------------ | ------------------------------------------- | ----------- | ----------- |
| Owner        | always           | yes                            | settings, visibility, collaborators, delete | no          | no          |
| Collaborator | always           | only while collaboration is on | leave                                       | no          | no          |
| Anyone else  | only when public | no                             | no                                          | when public | when public |

- **Owner**: `playlists.user_id` / `crates.owner_id`. The owner row in `playlist_members` is a
  legacy duplicate and is not used to decide ownership.
- **Collaborator**: a member row (`playlist_members` with role `collab`, `crate_members`). Editing
  also requires `is_collaborative = TRUE`; turning collaboration off makes collaborators
  read-only without removing them.
- **Visibility**: `private` (owner and collaborators only) or `public` (any signed-in user of
  the instance, and the public Crate share page).
- **Instance admins** keep their API bypass for moderation, but the `access` field reports their
  real role, so Listen only offers editing on what they own or collaborate on.

## Access contract

Every playlist and Crate payload carries the viewer's access, computed in one place per entity:

```json
{
  "access": "owner | collaborator | public",
  "can_edit": true,
  "is_followed": false,
  "follower_count": 3
}
```

`access` is `collaborator` only for members of collaborative entities; a member of a
non-collaborative entity is reported as `public` (read-only, followable when public).
`members` are only returned to the owner and collaborators.

Listen derives every affordance from this field through one helper
(`canEdit`, `canManage`, `canFollow`, `canLeave`, `canCopy`).

## Collaboration management

- The owner adds collaborators directly (`POST .../members` with `user_id` or `username`) and
  removes them (`DELETE .../members/{user_id}`). Adding a collaborator turns collaboration on.
  Listen picks people through the instance user search.
- A collaborator can leave: `POST /api/playlists/{id}/leave`, or
  `DELETE /api/crates/{id}/members/{own user_id}` for Crates.
- Invite links are disabled: creating and accepting invites returns 410 Gone and Listen no longer
  exposes them. The tables stay for history; members who joined through an invite remain
  collaborators.
- Adding a collaborator emits a `collaborator_added` domain event, ready for the notifications
  work to turn into a push notification.

## Follow and copy

- Public user playlists can be followed (`/api/playlists/{id}/follow`); the system playlist
  follow endpoints under `/api/curation` keep working.
- "Add to my playlists" / "Add to my Crates" (`POST .../copy`) copies a public entity into a new
  private one owned by the viewer, with the same tracks or albums in the same order. The copy is
  independent.

## Library

Listen's library separates playlists the viewer owns, playlists shared with them as a
collaborator (with the owner shown), followed user playlists and followed Crate playlists.
`/api/me/playlists-page` returns all of them from one read transaction, with owner names
attached in a single batched lookup. Crates split the same way into owned, shared and followed.

## Migration

Migration 107 constrains `playlists.visibility` to `private`/`public` (normalising anything else to
`private`) and expires every outstanding playlist and Crate invite.
