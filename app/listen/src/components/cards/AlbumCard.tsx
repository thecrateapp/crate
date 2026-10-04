import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import {
  EntityCard,
  EntityRow,
  type EntityCardOverlay,
  type EntityMenuRenderer,
} from "@crate/ui/domain/entity";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { albumPagePath } from "@/lib/library-routes";
import { isOfflineBusy, type OfflineItemState } from "@/lib/offline";
import {
  AlbumCardArtwork,
  AlbumCardArtworkBadges,
  AlbumCardMenu,
  AlbumCardSubtitle,
  useAlbumCardModel,
  useAlbumCardPlayback,
  type AlbumCardProps,
} from "./AlbumCardParts";

export type { AlbumCardProps } from "./AlbumCardParts";

function offlineActionClassName(state: OfflineItemState) {
  if (state === "ready") {
    return "bg-accent-action/[0.04] hover:bg-accent-action/[0.04]";
  }
  if (isOfflineBusy(state)) {
    return "bg-accent-action/[0.05] hover:bg-accent-action/[0.05]";
  }
  if (state === "error") {
    return "bg-state-warning/[0.05] hover:bg-state-warning/[0.05]";
  }
  return undefined;
}

export const AlbumCard = memo(function AlbumCard({
  artist,
  album,
  albumId,
  albumEntityUid,
  globalAlbumUid,
  artistEntityUid,
  albumSlug,
  artistSlug,
  year,
  cover,
  isPreRelease = false,
  releaseDate,
  compact,
  layout = "rail",
  variant = "tile",
  rank,
  meta,
  extraActions,
}: AlbumCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const model = useAlbumCardModel({
    artist,
    album,
    albumId,
    albumEntityUid,
    globalAlbumUid,
    artistEntityUid,
    albumSlug,
    artistSlug,
    year,
    cover,
    isPreRelease,
    releaseDate,
    compact,
    layout,
    variant,
  });

  const { playing, handlePlayOverlay } = useAlbumCardPlayback({
    albumRouteInput: model.albumRouteInput,
    album,
    albumId,
    artist,
    coverUrl: model.coverUrl,
    globalAlbumUid,
    playAll,
  });

  const albumPath = albumPagePath(model.albumRouteInput);
  const openAlbum = useCallback(
    () => navigate(albumPath),
    [navigate, albumPath],
  );
  const { menuInput, saved, savedLabel, handleToggleSaved } = model;
  const renderMenu = useCallback<EntityMenuRenderer>(
    (controller) => (
      <AlbumCardMenu
        actionMenu={controller}
        extraActions={extraActions}
        input={menuInput}
      />
    ),
    [extraActions, menuInput],
  );
  const canSave = albumId != null || Boolean(globalAlbumUid);
  const playLabel = t("common.playItem", { name: album });
  const overlay = useMemo<EntityCardOverlay>(
    () => ({
      onPlay: handlePlayOverlay,
      loading: playing,
      playLabel,
      follow: canSave
        ? {
            following: saved,
            label: savedLabel,
            onToggle: handleToggleSaved,
          }
        : undefined,
    }),
    [
      canSave,
      handlePlayOverlay,
      handleToggleSaved,
      playLabel,
      playing,
      saved,
      savedLabel,
    ],
  );
  const subtitle = (
    <AlbumCardSubtitle
      artist={artist}
      year={year}
      isPreRelease={model.isPreRelease}
      releaseDate={model.releaseDate}
      offlineMeta={model.offlineMeta}
      offlineState={model.offlineState}
    />
  );
  const menuLabel = t("actions.menu.more");

  if (variant === "row") {
    return (
      <EntityRow
        title={album}
        subtitle={subtitle}
        meta={meta}
        rank={rank}
        leading={
          <AlbumCardArtwork
            coverArtwork={model.coverArtwork}
            coverSizes={model.coverSizes}
            album={album}
            iconSize={CRATE_ICON_SIZE.md}
            className="relative size-12 shrink-0 overflow-hidden rounded-md bg-text-primary/5"
          />
        }
        onOpen={openAlbum}
        renderMenu={renderMenu}
        menuLabel={menuLabel}
      />
    );
  }

  const actionClassName = offlineActionClassName(model.offlineState);

  return (
    <EntityCard
      title={album}
      subtitle={subtitle}
      meta={meta}
      rank={rank}
      layout={layout}
      compact={compact}
      className={layout === "grid" ? "listen-deferred-grid-item" : undefined}
      classNames={actionClassName ? { action: actionClassName } : undefined}
      artwork={
        <AlbumCardArtwork
          coverArtwork={model.coverArtwork}
          coverSizes={model.coverSizes}
          album={album}
          className="size-full"
        />
      }
      artworkOverlay={
        <AlbumCardArtworkBadges
          offlineState={model.offlineState}
          isPreRelease={model.isPreRelease}
        />
      }
      overlay={overlay}
      onOpen={openAlbum}
      renderMenu={renderMenu}
      menuLabel={menuLabel}
    />
  );
});
