import { TrackRowView } from "./TrackRowView";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { TrackRowContent } from "./TrackRowContent";
import {
  formatTrackAnalysis,
  formatMusicalKey,
} from "@crate/ui/lib/track-meta";
import { getQualityBadge } from "../player/bar/player-bar-utils";
import { memo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { formatDuration } from "@/lib/utils";
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
import { Clock } from "@crate/ui/icons";

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
  const tempo = formatTrackAnalysis(track.bpm);
  const musicalKey = formatMusicalKey(track.audio_key, track.audio_scale);
  const quality = getQualityBadge({
    format: track.format,
    path: track.path,
    bitrate: track.bitrate,
    bitDepth: track.bit_depth,
    sampleRate: track.sample_rate,
  });
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
    <TrackRowView
      active={isActive}
      selected={selected}
      disabled={model.disabled}
      density={density}
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
      onDoubleClick={
        selectable
          ? (event) => {
              event.preventDefault();
              void playback.handleActivate();
            }
          : undefined
      }
    >
      <TrackRowContent
        rank={rank}
        leading={
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
        }
        title={track.title || t("trackRow.unknownTitle")}
        titleAccessory={
          <>
            {!model.isRemote ? (
              <OfflineBadge
                state={model.offlineState}
                compact
                subtle
                className="shrink-0"
              />
            ) : null}
            {model.disabled ? (
              <InfoBadge icon={Clock} tone="neutral">
                {t("trackRow.soon")}
              </InfoBadge>
            ) : null}
          </>
        }
        details={
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
        }
        meta={meta}
        quality={quality}
        tempo={tempo}
        musicalKey={musicalKey}
        explicitLabel={track.explicit ? t("trackRow.explicit") : undefined}
        provenance={
          model.isRemote && (track.node_name || track.node_uid) ? (
            <>
              {track.availability?.stale ||
              track.availability?.healthy === false ? (
                <span aria-hidden="true" className="crate-track-source-ring" />
              ) : null}
              {t("trackRow.via", { node: track.node_name || track.node_uid })}
            </>
          ) : undefined
        }
        duration={
          showDuration && track.duration != null && track.duration > 0
            ? formatDuration(track.duration)
            : undefined
        }
        like={
          showLike ? (
            <TrackRowLikeControl
              hasTrackRef={model.hasTrackRef}
              liked={model.liked}
              toggleTrackLike={toggleTrackLike}
              track={track}
            />
          ) : null
        }
        actions={
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
        }
      />
    </TrackRowView>
  );
});
