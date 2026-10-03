import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { CRATE_ICON_SIZE, Disc3 } from "@crate/ui/icons";

import {
  ItemActionMenuButton,
  useItemActionTarget,
} from "@/components/actions/ItemActionMenu";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { albumPagePath } from "@/lib/library-routes";
import { isOfflineBusy } from "@/lib/offline";
import { cn } from "@/lib/utils";
import {
  AlbumCardArtworkControls,
  AlbumCardArtworkSurface,
  AlbumCardDetails,
  AlbumCardMenu,
  useAlbumCardModel,
  useAlbumCardPlayback,
  type AlbumCardProps,
} from "./AlbumCardParts";

export type { AlbumCardProps } from "./AlbumCardParts";

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
  const actionTarget = useItemActionTarget(model.actionMenu);

  const { playing, handlePlayOverlay } = useAlbumCardPlayback({
    albumRouteInput: model.albumRouteInput,
    album,
    albumId,
    artist,
    coverUrl: model.coverUrl,
    globalAlbumUid,
    playAll,
  });

  const openAlbum = () => navigate(albumPagePath(model.albumRouteInput));
  const menu = model.actionMenu.open ? (
    <AlbumCardMenu
      actionMenu={model.actionMenu}
      extraActions={extraActions}
      input={model.menuInput}
    />
  ) : null;
  const details = (
    <AlbumCardDetails
      album={album}
      artist={artist}
      year={year}
      isPreRelease={model.isPreRelease}
      releaseDate={model.releaseDate}
      offlineMeta={model.offlineMeta}
      offlineState={model.offlineState}
      rank={variant === "tile" ? rank : undefined}
      meta={meta}
    />
  );

  if (variant === "row") {
    return (
      <article
        className="item-action-target group/card relative flex items-center gap-[var(--content-row-gap)] rounded-lg px-3 py-[var(--content-row-padding-y)] text-left transition-colors hover:bg-text-primary/5"
        data-variant="row"
        {...actionTarget}
      >
        {rank != null ? (
          <span className="w-6 shrink-0 text-right text-xs tabular-nums text-text-muted">
            {rank}
          </span>
        ) : null}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-[var(--content-row-gap)] rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={openAlbum}
        >
          <ArtworkSurface
            source={{
              ...model.coverArtwork,
              sizes: model.coverArtwork.srcSet ? model.coverSizes : undefined,
            }}
            alt={album}
            className="relative size-12 shrink-0 overflow-hidden rounded-md bg-text-primary/5"
            fallback={
              <div className="grid size-full place-items-center bg-surface-elevated text-text-primary/35">
                <Disc3 size={CRATE_ICON_SIZE.md} />
              </div>
            }
            imageProps={{ loading: "lazy", decoding: "async" }}
            imageClassName="object-cover"
          />
          <span className="block min-w-0 flex-1">{details}</span>
        </button>
        <ItemActionMenuButton
          buttonRef={model.actionMenu.triggerRef}
          hasActions={model.actionMenu.hasActions}
          onClick={model.actionMenu.openFromTrigger}
          expanded={model.actionMenu.open}
          title={t("actions.menu.more")}
          className="size-9 shrink-0 opacity-100 transition-opacity md:opacity-65 md:group-hover/card:opacity-100"
        />
        {menu}
      </article>
    );
  }

  return (
    <article
      className={cn(
        "item-action-target group/card relative snap-start rounded-xl text-left transition-colors",
        layout === "grid"
          ? "listen-deferred-grid-item w-full min-w-0"
          : `shrink-0 ${compact ? "w-[120px]" : "w-[160px]"}`,
      )}
      {...actionTarget}
    >
      <button
        type="button"
        className={cn(
          "group block w-full rounded-xl p-[var(--content-card-padding)] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          model.offlineState === "ready"
            ? "bg-accent-action/[0.04]"
            : isOfflineBusy(model.offlineState)
              ? "bg-accent-action/[0.05]"
              : model.offlineState === "error"
                ? "bg-state-warning/[0.05]"
                : "hover:bg-text-primary/5",
        )}
        onClick={openAlbum}
      >
        <AlbumCardArtworkSurface
          coverArtwork={model.coverArtwork}
          coverSizes={model.coverSizes}
          album={album}
          offlineState={model.offlineState}
          isPreRelease={model.isPreRelease}
        />
        {details}
      </button>
      <AlbumCardArtworkControls
        album={album}
        albumId={albumId}
        globalAlbumUid={globalAlbumUid}
        saved={model.saved}
        savedLabel={model.savedLabel}
        onToggleSaved={model.handleToggleSaved}
        playing={playing}
        onPlayOverlay={handlePlayOverlay}
      />
      <ItemActionMenuButton
        buttonRef={model.actionMenu.triggerRef}
        hasActions={model.actionMenu.hasActions}
        onClick={model.actionMenu.openFromTrigger}
        expanded={model.actionMenu.open}
        title={t("actions.menu.more")}
        className="absolute left-4 top-4 z-20 size-10 opacity-75 transition-opacity hover:opacity-100 md:opacity-0 md:group-focus-within/card:opacity-100 md:group-hover/card:opacity-100"
      />
      {menu}
    </article>
  );
});
