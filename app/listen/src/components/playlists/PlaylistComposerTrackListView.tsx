import type { ComponentProps } from "react";
import { trackCoverPath } from "../search/catalog-search-model";
import { Button } from "@crate/ui/shadcn/button";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, GripVertical, Music2, Trash2 } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { CollectionEditorItemRow } from "../collections/CollectionEditorItemRow";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { PlaylistComposerTrack } from "./playlist-composer-model";
import { getTrackKey } from "./playlist-composer-model";
import { formatDuration } from "../../lib/utils";

function SortableTrackItem({
  track,
  onRemove,
  renderImage,
}: {
  track: PlaylistComposerTrack;
  onRemove: () => void;
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
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
    <div ref={setNodeRef} style={style}>
      <CollectionEditorItemRow
        title={track.title}
        subtitle={
          <>
            {track.artist}
            {track.album ? ` · ${track.album}` : ""}
          </>
        }
        artwork={
          <MediaCover
            alt=""
            src={trackCoverPath(track)}
            renderImage={renderImage}
            fallbackIcon={Music2}
            size={48}
          />
        }
        meta={
          track.duration ? (
            <MonoLabel as="span">{formatDuration(track.duration)}</MonoLabel>
          ) : undefined
        }
        dragHandle={
          <Button
            {...attributes}
            {...listeners}
            variant="ghost"
            size="icon-lg"
            aria-label={t("library.crates.dragAlbum", { name: track.title })}
            title={t("library.crates.ordering")}
            className="cursor-grab touch-none"
          >
            <GripVertical size={CRATE_ICON_SIZE.md} />
          </Button>
        }
        actions={
          <ActionButton
            label={t("library.crates.removeAlbum", { name: track.title })}
            tooltip={t("common.remove")}
            onClick={onRemove}
          >
            <Trash2 size={CRATE_ICON_SIZE.md} />
          </ActionButton>
        }
      />
    </div>
  );
}

export function PlaylistComposerTrackListView({
  tracks,
  t,
  onDragEnd,
  onRemove,
  renderImage,
}: {
  tracks: PlaylistComposerTrack[];
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
  t: ReturnType<typeof useTranslation>["t"];
  onDragEnd: (event: DragEndEvent) => void;
  onRemove: (track: PlaylistComposerTrack) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionHeader
        as="h3"
        title={t("common.tracks")}
        subtitle={
          tracks.length > 0 ? (
            <MonoLabel>
              {t("playlistComposer.selectedCount", { count: tracks.length })}
            </MonoLabel>
          ) : (
            t("playlistComposer.addTracksLater")
          )
        }
      />

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
                    renderImage={renderImage}
                    onRemove={() => onRemove(track)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <EmptyState message={t("playlistComposer.emptyTracks")} />
          )}
        </div>
      </div>
    </div>
  );
}
