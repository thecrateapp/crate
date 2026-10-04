import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, GripVertical, Music2, X } from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { PlaylistComposerTrack } from "@/components/playlists/playlist-composer-model";
import { getTrackKey } from "@/components/playlists/playlist-composer-model";
import { formatDuration } from "@/lib/utils";

function SortableTrackItem({
  track,
  onRemove,
}: {
  track: PlaylistComposerTrack;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: getTrackKey(track) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-2 px-3 py-2.5"
    >
      <IconButton
        {...attributes}
        {...listeners}
        label={t("library.crates.dragAlbum", { name: track.title })}
        size="sm"
        className="size-6 cursor-grab touch-none text-text-primary/20 hover:translate-y-0 hover:text-text-primary/50"
      >
        <GripVertical size={CRATE_ICON_SIZE.xs} className="size-3.5" />
      </IconButton>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="size-9  rounded-md bg-text-primary/5 flex items-center justify-center shrink-0">
          <Music2 size={CRATE_ICON_SIZE.sm} className="text-text-muted" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm text-text-primary">
            {track.title}
          </div>
          <div className="truncate text-xs text-text-muted">
            {track.artist}
            {track.album ? ` · ${track.album}` : ""}
            {track.duration ? ` · ${formatDuration(track.duration)}` : ""}
          </div>
        </div>
      </div>
      <IconButton
        label={t("library.crates.removeAlbum", { name: track.title })}
        size="sm"
        onClick={onRemove}
      >
        <X size={CRATE_ICON_SIZE.xs} />
      </IconButton>
    </div>
  );
}

export function PlaylistComposerTrackList({
  tracks,
  t,
  onDragEnd,
  onRemove,
}: {
  tracks: PlaylistComposerTrack[];
  t: ReturnType<typeof useTranslation>["t"];
  onDragEnd: (event: DragEndEvent) => void;
  onRemove: (track: PlaylistComposerTrack) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t("common.tracks")}
          </h3>
          <p className="text-xs text-text-muted">
            {tracks.length > 0
              ? t("playlistComposer.selectedCount", { count: tracks.length })
              : t("playlistComposer.addTracksLater")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border-quiet bg-text-primary/5">
        <div className="max-h-64 overflow-y-auto py-1.5">
          {tracks.length > 0 ? (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={tracks.map(getTrackKey)}
                strategy={verticalListSortingStrategy}
              >
                {tracks.map((track) => (
                  <SortableTrackItem
                    key={getTrackKey(track)}
                    track={track}
                    onRemove={() => onRemove(track)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              {t("playlistComposer.emptyTracks")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
