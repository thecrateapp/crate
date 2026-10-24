import { useId, useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "@crate/ui/icons";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { formatDuration } from "@/lib/utils";

export interface PlaylistEditorTrack {
  /** Playlist-entry ID, which may differ from the underlying library track ID. */
  id?: number;
  title: string;
  artist?: string;
  album?: string;
  duration?: number | null;
  source?: string | null;
  locked?: boolean | null;
  format?: string | null;
}

export interface PlaylistEditorTrackListProps<T extends PlaylistEditorTrack> {
  tracks: readonly T[];
  onRemove: (track: T, position1based: number) => void | Promise<void>;
  onReorder: (playlistEntryIds: number[]) => void | Promise<void>;
  busy?: boolean;
}

/** Controlled entry order; the parent retains persistence and its result/error reporting. */
export function PlaylistEditorTrackList<T extends PlaylistEditorTrack>({
  tracks,
  onRemove,
  onReorder,
  busy = false,
}: PlaylistEditorTrackListProps<T>) {
  const instructionsId = useId();
  const pendingRef = useRef(false);
  const draggedId = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");
  const ids = tracks.map((track) => track.id);
  const persistedIds = ids.filter(
    (id): id is number => typeof id === "number" && Number.isSafeInteger(id),
  );
  const idCounts = new Map<number, number>();
  for (const id of persistedIds) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  const canReorder =
    persistedIds.length === tracks.length && idCounts.size === tracks.length;
  const unavailable = busy || pending;

  function clearDrag() {
    draggedId.current = null;
    setDragging(null);
  }

  async function perform(action: () => void | Promise<void>, message: string) {
    if (busy || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await action();
      setAnnouncement(message);
    } catch {
      setError("The track list could not be updated. Try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function move(from: number, to: number) {
    clearDrag();
    if (
      !canReorder ||
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= tracks.length ||
      to >= tracks.length
    )
      return;
    const order = [...persistedIds];
    const [entry] = order.splice(from, 1);
    if (entry == null) return;
    order.splice(to, 0, entry);
    void perform(
      () => onReorder(order),
      `Moved ${tracks[from]!.title} to position ${to + 1}.`,
    );
  }

  function startDrag(event: DragEvent<HTMLLIElement>, id: number | undefined) {
    if (unavailable || pendingRef.current || !canReorder || id == null) {
      event.preventDefault();
      return;
    }
    draggedId.current = id;
    setDragging(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(id));
  }

  return (
    <div className="min-w-0 space-y-3">
      <p id={instructionsId} className="text-sm text-text-muted">
        Drag tracks to reorder, or use Move up and Move down.
      </p>
      {!canReorder && tracks.length > 1 ? (
        <p className="text-sm text-text-muted">
          Some entries cannot be reordered yet.
        </p>
      ) : null}
      <HairlineList
        as="ol"
        label="Playlist tracks"
        aria-describedby={instructionsId}
        aria-busy={unavailable}
      >
        {tracks.map((track, index) => {
          const uniqueId = track.id != null && idCounts.get(track.id) === 1;
          const identity = [track.artist, track.album]
            .filter(Boolean)
            .join(" · ");
          return (
            <HairlineRow
              key={uniqueId ? track.id : `position:${index}`}
              data-playlist-entry-id={track.id}
              index={index + 1}
              truncate={false}
              active={dragging != null && dragging === track.id}
              draggable={canReorder && !unavailable}
              onDragStart={(event) => startDrag(event, track.id)}
              onDragOver={(event) => {
                if (canReorder && !unavailable && draggedId.current != null)
                  event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedId.current == null || unavailable) return;
                move(persistedIds.indexOf(draggedId.current), index);
              }}
              onDragEnd={clearDrag}
              trailing={
                <ActionGroup
                  label={`Actions for ${track.title}, position ${index + 1}`}
                >
                  <ActionButton
                    label={`Move ${track.title} up, position ${index + 1}`}
                    tooltip="Move up"
                    disabled={unavailable || !canReorder || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp
                      data-admin-ux="playlist-track-move-up"
                      aria-hidden="true"
                    />
                  </ActionButton>
                  <ActionButton
                    label={`Move ${track.title} down, position ${index + 1}`}
                    tooltip="Move down"
                    disabled={
                      unavailable || !canReorder || index === tracks.length - 1
                    }
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown
                      data-admin-ux="playlist-track-move-down"
                      aria-hidden="true"
                    />
                  </ActionButton>
                  <ActionButton
                    label={`Remove ${track.title}, position ${index + 1}`}
                    tooltip="Remove"
                    disabled={unavailable}
                    onClick={() =>
                      void perform(
                        () => onRemove(track, index + 1),
                        `Removed ${track.title}.`,
                      )
                    }
                  >
                    <Trash2
                      data-admin-ux="playlist-track-remove"
                      aria-hidden="true"
                    />
                  </ActionButton>
                </ActionGroup>
              }
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  {track.title}
                </p>
                {identity ? (
                  <p className="text-sm text-text-muted">{identity}</p>
                ) : null}
                <MonoLabel
                  as="p"
                  meta={[
                    track.locked ? "locked" : track.source || "track",
                    track.format,
                    track.duration != null && Number.isFinite(track.duration)
                      ? formatDuration(track.duration)
                      : null,
                  ]}
                />
              </div>
            </HairlineRow>
          );
        })}
      </HairlineList>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-state-warning-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
