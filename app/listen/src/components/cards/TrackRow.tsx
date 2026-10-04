import { memo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { cn, formatDuration } from "@/lib/utils";
import { useItemActionTarget } from "@/components/actions/ItemActionMenu";
import {
  TrackRowActions,
  TrackRowDetails,
  TrackRowLeadingControl,
  TrackRowLikeControl,
} from "@/components/cards/TrackRowParts";
import {
  useTrackRowModel,
  useTrackRowPlayback,
  type TrackRowProps,
} from "@/components/cards/TrackRowModel";

export type {
  TrackRowData,
  TrackRowProps,
} from "@/components/cards/TrackRowModel";

export const TrackRow = memo(function TrackRow({
  track,
  index,
  showArtist = false,
  showAlbum = false,
  albumCover,
  showCoverThumb = false,
  playlistOptions,
  onAddToPlaylist,
  onCreatePlaylist,
  onActionMenuOpen,
  onPlayOverride,
  isActiveOverride,
  selectable = false,
  selected = false,
  onSelect,
  onSelectionActionMenuOpen,
  queueTracks,
  playSource,
  rank,
  meta,
  density = "default",
  extraActions,
  showLike = true,
  showDuration = true,
}: TrackRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isPlaying } = usePlayerState();
  const { currentTrack } = usePlayerActions();
  const { toggleTrackLike } = useLikedTracks();
  const model = useTrackRowModel({ track, albumCover, extraActions });
  const actionTarget = useItemActionTarget(model.actionMenu, {
    disabled: model.disabled,
  });
  const isActive = isActiveOverride ?? currentTrack?.id === model.playbackId;
  const compact = density === "compact";
  const playback = useTrackRowPlayback({
    disabled: model.disabled,
    isActive,
    isPlaying,
    onPlayOverride,
    playerTrack: model.playerTrack,
    playSource,
    queueTracks,
    track,
  });

  function handlePlayControlClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    void playback.handleActivate();
  }

  return (
    <div
      className={cn(
        "item-action-target group track-row flex items-center gap-[var(--content-row-gap)] rounded-lg transition-colors",
        compact ? "px-2 py-1.5" : "px-3 py-[var(--content-row-padding-y)]",
      )}
      data-active={isActive}
      data-density={density}
      data-disabled={model.disabled}
      data-selected={selected}
      aria-label={track.title}
      aria-selected={selectable ? selected : undefined}
      onContextMenu={actionTarget.onContextMenu}
      onPointerDown={actionTarget.onPointerDown}
      onPointerMove={actionTarget.onPointerMove}
      onPointerUp={actionTarget.onPointerUp}
      onPointerCancel={actionTarget.onPointerCancel}
      onPointerLeave={actionTarget.onPointerLeave}
      onClickCapture={actionTarget.onClickCapture}
      onClick={(event) => {
        if (model.disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event);
          return;
        }
        void playback.handleActivate();
      }}
      onKeyDown={(event) => {
        actionTarget.onKeyDown(event);
        if (event.defaultPrevented) return;
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (model.disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event as unknown as MouseEvent<HTMLDivElement>);
          return;
        }
        void playback.handleActivate();
      }}
      role="row"
      tabIndex={model.disabled ? -1 : 0}
      onDoubleClick={
        selectable
          ? (event) => {
              event.preventDefault();
              void playback.handleActivate();
            }
          : undefined
      }
    >
      {rank != null ? (
        <span className="w-6 shrink-0 text-right text-xs tabular-nums text-text-muted">
          {rank}
        </span>
      ) : null}
      <TrackRowLeadingControl
        compact={compact}
        cover={model.cover}
        disabled={model.disabled}
        index={index}
        isActive={isActive}
        isPlaying={isPlaying}
        playControlLabel={playback.playControlLabel}
        showCoverThumb={showCoverThumb}
        trackNumber={track.track_number}
        onClick={handlePlayControlClick}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-[var(--content-row-inline-gap)]">
          <div
            className={cn(
              "min-w-0 truncate text-sm",
              isActive ? "font-medium text-accent-action" : "text-text-primary",
            )}
          >
            {track.title || t("trackRow.unknownTitle")}
          </div>
          {!model.isRemote ? (
            <OfflineBadge
              state={model.offlineState}
              compact
              subtle
              className="shrink-0"
            />
          ) : null}
          {model.disabled ? (
            <span className="track-row-disabled-badge shrink-0 rounded-full px-2 py-0.5 text-xs uppercase tracking-caps">
              {t("trackRow.soon")}
            </span>
          ) : null}
        </div>
        <TrackRowDetails
          globalAlbumUid={track.global_album_uid}
          globalArtistUid={track.global_artist_uid}
          navigate={navigate}
          offlineLabel={model.offlineLabel}
          offlineState={model.offlineState}
          showAlbum={showAlbum}
          showArtist={showArtist}
          track={track}
        />
        {meta != null ? (
          <div className="truncate text-xs tabular-nums text-text-muted">
            {meta}
          </div>
        ) : null}
      </div>

      {showDuration && track.duration != null && track.duration > 0 && (
        <span className="text-text-muted shrink-0 text-xs tabular-nums">
          {formatDuration(track.duration)}
        </span>
      )}

      {showLike ? (
        <TrackRowLikeControl
          hasTrackRef={model.hasTrackRef}
          liked={model.liked}
          toggleTrackLike={toggleTrackLike}
          track={track}
        />
      ) : null}
      <TrackRowActions
        actionMenu={model.actionMenu}
        compact={compact}
        cover={model.cover}
        extraActions={extraActions}
        onActionMenuOpen={onActionMenuOpen}
        onAddToPlaylist={onAddToPlaylist}
        onCreatePlaylist={onCreatePlaylist}
        onPlayOverride={onPlayOverride}
        onSelectionActionMenuOpen={onSelectionActionMenuOpen}
        playlistOptions={playlistOptions}
        selectable={selectable}
        selected={selected}
        showLocalActions={model.showLocalActions}
        track={track}
      />
    </div>
  );
});
