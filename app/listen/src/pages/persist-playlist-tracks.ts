import type { PlaylistComposerTrack } from "@/components/playlists/playlist-composer-model";
import { api } from "@/lib/api";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";

interface PlaylistEntry {
  id: number;
  position: number;
  global_track_uid?: string;
  globalTrackUid?: string;
  track_id?: number;
  track_entity_uid?: string;
  track_path?: string | null;
}

export interface PlaylistTrackEditSession {
  addedEntryIds: Set<number>;
  requiresReconciliation: boolean;
  pendingAddition: {
    beforeIds: Set<number>;
    tracks: readonly PlaylistComposerTrack[];
  } | null;
}

export function createPlaylistTrackEditSession(): PlaylistTrackEditSession {
  return {
    addedEntryIds: new Set(),
    requiresReconciliation: false,
    pendingAddition: null,
  };
}

function matchesReference(track: PlaylistComposerTrack, entry: PlaylistEntry) {
  return Boolean(
    (track.globalTrackUid &&
      track.globalTrackUid ===
        (entry.global_track_uid ?? entry.globalTrackUid)) ||
    (track.entityUid && track.entityUid === entry.track_entity_uid) ||
    (track.libraryTrackId != null && track.libraryTrackId === entry.track_id) ||
    (track.path && track.path === entry.track_path),
  );
}

function recordSessionAdditions(
  session: PlaylistTrackEditSession,
  entries: readonly PlaylistEntry[],
) {
  const pending = session.pendingAddition;
  if (!pending) return;
  const candidates = entries.filter(
    (entry) => !pending.beforeIds.has(entry.id),
  );
  for (const track of pending.tracks) {
    const matching = candidates.filter((entry) =>
      matchesReference(track, entry),
    );
    const requested = pending.tracks.filter((item) =>
      matching.some((entry) => matchesReference(item, entry)),
    ).length;
    // The add endpoint returns a count, not IDs. Ambiguous concurrent copies must
    // remain untouched rather than be claimed as this editor's own additions.
    if (matching.length > requested)
      throw new Error("Playlist membership changed while adding tracks");
    for (const entry of matching) session.addedEntryIds.add(entry.id);
  }
  session.pendingAddition = null;
}

/** Reconcile membership, then reorder by playlist-entry IDs (not catalog track IDs). */
export async function persistPlaylistTracks(
  playlistId: string | number,
  original: readonly PlaylistComposerTrack[],
  desired: readonly PlaylistComposerTrack[],
  session: PlaylistTrackEditSession,
) {
  if (
    !session.requiresReconciliation &&
    session.addedEntryIds.size === 0 &&
    session.pendingAddition == null &&
    original.length === desired.length &&
    original.every(
      (track, index) =>
        track.playlistEntryId != null &&
        track.playlistEntryId === desired[index]?.playlistEntryId,
    )
  )
    return;

  session.requiresReconciliation = true;
  const endpoint = `/api/playlists/${playlistId}`;
  let { tracks: entries } = await api<{ tracks: PlaylistEntry[] }>(endpoint);
  recordSessionAdditions(session, entries);
  const originalIds = new Set(original.map((track) => track.playlistEntryId));
  const desiredIds = new Set(
    desired.map((track) => track.playlistEntryId).filter((id) => id != null),
  );
  for (const id of desiredIds) {
    if (!entries.some((entry) => entry.id === id))
      throw new Error("Playlist membership changed while editing");
  }
  const newTracks = desired.filter((track) => track.playlistEntryId == null);
  const available = entries
    .filter((entry) => !originalIds.has(entry.id))
    .sort(
      (a, b) =>
        Number(session.addedEntryIds.has(b.id)) -
        Number(session.addedEntryIds.has(a.id)),
    );
  const retainedNewIds = new Set<number>();
  const missing = newTracks.filter((track) => {
    const index = available.findIndex((entry) =>
      matchesReference(track, entry),
    );
    if (index < 0) return true;
    retainedNewIds.add(available.splice(index, 1)[0]!.id);
    return false;
  });
  const removed = entries
    .filter(
      (entry) =>
        (originalIds.has(entry.id) || session.addedEntryIds.has(entry.id)) &&
        !desiredIds.has(entry.id) &&
        !retainedNewIds.has(entry.id),
    )
    .sort((a, b) => b.position - a.position);
  for (const entry of removed) {
    await api(`${endpoint}/tracks/${entry.position}`, "DELETE");
    session.addedEntryIds.delete(entry.id);
  }
  const removedIds = new Set(removed.map((entry) => entry.id));
  entries = entries.filter((entry) => !removedIds.has(entry.id));
  // Reuse entries already added by a previous attempt if only its reorder failed.
  if (missing.length) {
    if (missing.some((track) => !hasTrackReference(track)))
      throw new Error("Track reference is unavailable");
    session.pendingAddition = {
      beforeIds: new Set(entries.map((entry) => entry.id)),
      tracks: missing,
    };
    await api(`${endpoint}/tracks`, "POST", {
      tracks: missing.map(toTrackReferencePayload),
    });
    ({ tracks: entries } = await api<{ tracks: PlaylistEntry[] }>(endpoint));
    recordSessionAdditions(session, entries);
  }
  const unused = [...entries];
  const orderedIds = desired.map((track) => {
    const index = unused.findIndex((entry) =>
      track.playlistEntryId != null
        ? entry.id === track.playlistEntryId
        : !originalIds.has(entry.id) && matchesReference(track, entry),
    );
    if (index < 0)
      throw new Error("The complete playlist order could not be saved");
    return unused.splice(index, 1)[0]!.id;
  });
  // Do not discard a collaborator's additions or submit an incomplete permutation.
  if (unused.length)
    throw new Error("Playlist membership changed while editing");
  await api(`${endpoint}/reorder`, "POST", { track_ids: orderedIds });
  session.requiresReconciliation = false;
}
