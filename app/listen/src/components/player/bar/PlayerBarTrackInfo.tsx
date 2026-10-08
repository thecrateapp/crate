import type { MouseEventHandler } from "react";

import { useItemActionTarget } from "@/components/actions/ItemActionMenu";
import { PlayerBarArtwork } from "@/components/player/bar/PlayerBarArtwork";
import { PlayerBarTrackActions } from "@/components/player/bar/PlayerBarTrackActions";
import { PlayerBarTrackCopy } from "@/components/player/bar/PlayerBarTrackCopy";
import {
  PlayerTrackMenuContent,
  usePlayerTrackActionMenu,
} from "@/components/player/bar/PlayerTrackMenu";
import type { CrossfadeTransition } from "@/contexts/player-context";
import type { PlaySource, Track } from "@/contexts/player-types";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";

export interface PlayerBarTrackInfoProps {
  displayTrack: Track;
  displayCrossfadeTransition: CrossfadeTransition | null;
  crossfadeProgress: number;
  displayPlaySource: PlaySource | null;
  sourceLabel: string | null;
  isDesktop: boolean;
  liked: boolean;
  isShapedRadioTrack: boolean;
  shapedRadioSessionId: string | null | undefined;
  onNavigate: (path: string) => void;
  onPrepareFullscreen: () => void;
  onOpenFullscreen: () => void;
  onToggleLike: () => void;
  onNextTrack: () => void;
  onOverlayChange: (open: boolean) => void;
}

export function PlayerBarTrackInfo({
  displayTrack,
  displayCrossfadeTransition,
  crossfadeProgress,
  displayPlaySource,
  sourceLabel,
  isDesktop,
  liked,
  isShapedRadioTrack,
  shapedRadioSessionId,
  onNavigate,
  onPrepareFullscreen,
  onOpenFullscreen,
  onToggleLike,
  onNextTrack,
  onOverlayChange,
}: PlayerBarTrackInfoProps) {
  const trackMenu = usePlayerTrackActionMenu(onOverlayChange);
  const actionTarget = useItemActionTarget(trackMenu.actionMenu);
  const handleAlbumNavigation = () => {
    if (!isDesktop || !(displayTrack.globalAlbumUid || displayTrack.albumId)) {
      return;
    }
    onNavigate(
      displayTrack.globalAlbumUid
        ? albumPagePath({
            albumId: displayTrack.albumId,
            globalAlbumUid: displayTrack.globalAlbumUid,
            albumSlug: displayTrack.albumSlug,
            albumName: displayTrack.album,
            artistName: displayTrack.artist,
          })
        : albumPagePath({
            albumId: displayTrack.albumId,
            albumSlug: displayTrack.albumSlug,
            albumName: displayTrack.album,
            artistName: displayTrack.artist,
          }),
    );
  };

  const handleArtistNavigation = () => {
    if (
      !isDesktop ||
      !(displayTrack.globalArtistUid || displayTrack.artistId)
    ) {
      return;
    }
    onNavigate(
      displayTrack.globalArtistUid
        ? artistPagePath({
            artistId: displayTrack.artistId,
            globalArtistUid: displayTrack.globalArtistUid,
            artistSlug: displayTrack.artistSlug,
            artistName: displayTrack.artist,
          })
        : artistPagePath({
            artistId: displayTrack.artistId,
            artistSlug: displayTrack.artistSlug,
            artistName: displayTrack.artist,
          }),
    );
  };

  const handleSourceNavigation: MouseEventHandler<HTMLButtonElement> = (
    event,
  ) => {
    event.stopPropagation();
    if (displayPlaySource?.href) onNavigate(displayPlaySource.href);
  };

  return (
    <div className="flex min-w-0 shrink-0 flex-1 items-center gap-3 md:w-[260px] md:flex-none lg:w-[340px] xl:w-[min(34vw,520px)] 2xl:w-[min(38vw,680px)]">
      <div
        role={isDesktop ? undefined : "button"}
        tabIndex={isDesktop ? undefined : 0}
        aria-label={isDesktop ? undefined : "Open fullscreen player"}
        className="item-action-target flex min-w-0 flex-1 touch-manipulation cursor-pointer items-center gap-3 rounded-xl md:flex-initial md:cursor-default"
        onContextMenu={actionTarget.onContextMenu}
        onPointerDown={actionTarget.onPointerDown}
        onPointerMove={actionTarget.onPointerMove}
        onPointerUp={actionTarget.onPointerUp}
        onPointerCancel={actionTarget.onPointerCancel}
        onPointerLeave={actionTarget.onPointerLeave}
        onClickCapture={actionTarget.onClickCapture}
        onTouchStart={() => {
          if (!isDesktop) onPrepareFullscreen();
        }}
        onClick={() => {
          if (!isDesktop) onOpenFullscreen();
        }}
        onKeyDown={(event) => {
          actionTarget.onKeyDown(event);
          if (event.defaultPrevented) return;
          if (!isDesktop && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onOpenFullscreen();
          }
        }}
      >
        <PlayerBarArtwork
          displayTrack={displayTrack}
          displayCrossfadeTransition={displayCrossfadeTransition}
          crossfadeProgress={crossfadeProgress}
          isDesktop={isDesktop}
          liked={liked}
          onOpenAlbum={handleAlbumNavigation}
        />

        <PlayerBarTrackCopy
          displayTrack={displayTrack}
          displayCrossfadeTransition={displayCrossfadeTransition}
          crossfadeProgress={crossfadeProgress}
          displayPlaySource={displayPlaySource}
          sourceLabel={sourceLabel}
          isDesktop={isDesktop}
          onOpenAlbum={handleAlbumNavigation}
          onOpenArtist={handleArtistNavigation}
          onOpenSource={handleSourceNavigation}
        />
      </div>

      {isDesktop ? (
        <PlayerBarTrackActions
          displayTrack={displayTrack}
          isShapedRadioTrack={isShapedRadioTrack}
          liked={liked}
          onNextTrack={onNextTrack}
          onToggleLike={onToggleLike}
          shapedRadioSessionId={shapedRadioSessionId}
        />
      ) : null}

      {trackMenu.actionMenu.open ? (
        <PlayerTrackMenuContent {...trackMenu} currentTrack={displayTrack} />
      ) : null}
    </div>
  );
}
