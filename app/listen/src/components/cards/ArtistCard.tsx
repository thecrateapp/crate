import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { memo, useCallback, useMemo } from "react";
import {
  EntityCard,
  EntityRow,
  type EntityCardOverlay,
  type EntityMenuRenderer,
} from "@crate/ui/domain/entity";

import {
  ArtistCardArtwork,
  ArtistCardMenu,
  useArtistCardFollow,
  useArtistCardModel,
  useArtistCardPlayback,
  type ArtistCardProps,
} from "./ArtistCardParts";
import { usePlayerActions } from "@/contexts/PlayerContext";

export type { ArtistCardProps, ArtistCardVariant } from "./ArtistCardParts";

export const ArtistCard = memo(function ArtistCard({
  name,
  artistId,
  artistEntityUid,
  globalArtistUid,
  artistSlug,
  photo,
  hasPhoto,
  subtitle,
  compact = false,
  href,
  external = false,
  imageTone = "normal",
  large = false,
  layout = "rail",
  fillGrid = false,
  variant: variantProp = "tile",
  rank,
  meta,
}: ArtistCardProps) {
  const variant = variantProp === "tile" && large ? "editorial" : variantProp;
  const { playAll } = usePlayerActions();
  const model = useArtistCardModel({
    name,
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    photo,
    hasPhoto,
    compact,
    href,
    external,
    layout,
    variant,
  });
  const { t } = model;
  const { handlePlayTopTracks, playingTopTracks } = useArtistCardPlayback({
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    name,
    playAll,
    t,
  });
  const { handleToggleFollow, togglingFollow } = useArtistCardFollow({
    artistId,
    globalArtistUid,
    name,
    toggleArtistFollow: model.toggleArtistFollow,
  });
  const { photoUrl } = model;
  const renderMenu = useCallback<EntityMenuRenderer>(
    (controller) => (
      <ArtistCardMenu
        actionMenu={controller}
        name={name}
        subtitle={subtitle}
        artistId={artistId}
        artistEntityUid={artistEntityUid}
        globalArtistUid={globalArtistUid}
        artistSlug={artistSlug}
        photoUrl={photoUrl}
      />
    ),
    [
      name,
      subtitle,
      artistId,
      artistEntityUid,
      globalArtistUid,
      artistSlug,
      photoUrl,
    ],
  );
  const showOverlay =
    variant !== "row" &&
    !external &&
    model.hasPlayableArtist &&
    model.canUseInlineHoverActions;
  const { following } = model;
  const overlay = useMemo<EntityCardOverlay | undefined>(
    () =>
      showOverlay
        ? {
            onPlay: handlePlayTopTracks,
            loading: playingTopTracks,
            playLabel: t("actions.artist.playTopTracksFrom", { name }),
            follow: {
              following,
              loading: togglingFollow,
              label: t("actions.artist.followNamed", { name }),
              labelActive: t("actions.artist.unfollowNamed", { name }),
              onToggle: handleToggleFollow,
            },
          }
        : undefined,
    [
      following,
      handlePlayTopTracks,
      handleToggleFollow,
      name,
      playingTopTracks,
      showOverlay,
      t,
      togglingFollow,
    ],
  );
  const openLabel = t("actions.artist.openNamed", { name });
  const menuLabel = t("actions.menu.more");

  if (variant === "row") {
    return (
      <EntityRow
        title={name}
        subtitle={
          subtitle ? <MonoLabel as="span">{subtitle}</MonoLabel> : undefined
        }
        meta={
          typeof meta === "string" || typeof meta === "number" ? (
            <MonoLabel as="span">{meta}</MonoLabel>
          ) : (
            meta
          )
        }
        rank={rank}
        shape="circle"
        leading={
          <ArtistCardArtwork
            photoArtwork={model.photoArtwork}
            name={name}
            imageTone={imageTone}
            monogram={model.monogram}
            className="relative size-12 shrink-0"
          />
        }
        href={model.targetHref}
        external={external}
        openLabel={openLabel}
        renderMenu={renderMenu}
        menuButton={external ? "none" : "hover"}
        menuLabel={menuLabel}
      />
    );
  }

  const sizeKey =
    variant === "editorial" ? "editorial" : compact ? "compact" : "tile";

  return (
    <EntityCard
      title={name}
      subtitle={
        subtitle ? <MonoLabel as="span">{subtitle}</MonoLabel> : undefined
      }
      meta={
        typeof meta === "string" || typeof meta === "number" ? (
          <MonoLabel as="span">{meta}</MonoLabel>
        ) : (
          meta
        )
      }
      rank={rank}
      shape="circle"
      layout={layout}
      profileSize={sizeKey}
      fillGrid={fillGrid}
      className={layout === "grid" ? "listen-deferred-grid-item" : undefined}
      artwork={
        <ArtistCardArtwork
          photoArtwork={model.photoArtwork}
          name={name}
          imageTone={imageTone}
          monogram={model.monogram}
          className="size-full"
        />
      }
      overlay={overlay}
      href={model.targetHref}
      external={external}
      openLabel={openLabel}
      renderMenu={renderMenu}
      menuButton="none"
      menuLabel={menuLabel}
    />
  );
});
