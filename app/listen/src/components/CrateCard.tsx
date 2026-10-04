import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Disc3, Lock } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import {
  EntityCard,
  EntityRow,
  type EntityCardOverlay,
} from "@crate/ui/domain/entity";
import { useCrateActionMenu } from "@/components/actions/crate-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  buildCrateSharePayload,
  crateOwnerName,
  cratePagePath,
  crateSummaryAlbums,
  isShareableCrate,
  orderCrateAlbums,
} from "@/components/crates/crate-model";
import { useCrateFollow } from "@/components/crates/use-crate-follow";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { openShareSheet } from "@/lib/social-share";
import { cn } from "@/lib/utils";
import type { CrateSummary } from "@/pages/crates-types";

type Handler = () => void | Promise<void>;

interface CrateCardProps {
  crate: CrateSummary;
  variant?: "tile" | "row";
  onEdit?: Handler;
  onPlay?: Handler;
  onShuffle?: Handler;
  onStartRadio?: Handler;
  onMakeAvailableOffline?: Handler;
  onDownload?: Handler;
  offlineActionLabel?: string;
  offlineActionDisabled?: boolean;
  offlineActionActive?: boolean;
  layout?: "rail" | "grid";
}

const ARROW_CLASS_NAME =
  "pointer-events-auto absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white opacity-0 transition hover:bg-black/65 focus-visible:opacity-100 disabled:opacity-0 group-hover/card:opacity-100 group-hover/card:disabled:opacity-30 pointer-coarse:hidden";

function crateAccessLabelKey(crate: CrateSummary) {
  if (crate.access === "collaborator") return "library.crates.sharedWithYou";
  return crate.visibility === "private"
    ? "library.crates.private"
    : "library.crates.public";
}

function useCrateCardModel({
  crate,
  onEdit,
  onPlay,
  onShuffle,
  onStartRadio,
  onMakeAvailableOffline,
  onDownload,
  offlineActionLabel,
  offlineActionDisabled,
  offlineActionActive,
}: CrateCardProps) {
  const { t } = useTranslation();
  const albums = useMemo(
    () =>
      orderCrateAlbums(
        crateSummaryAlbums(crate),
        crate.is_ordered,
        crate.sort_direction,
      ),
    [crate],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAlbum = albums[activeIndex] ?? albums[0] ?? null;
  const canFollow = crate.access === "public" && crate.visibility === "public";
  const crateFollow = useCrateFollow({
    crateId: crate.id,
    initialFollowed: crate.is_followed ?? false,
    initialFollowerCount: crate.follower_count ?? 0,
    enabled: canFollow,
  });
  const cover = activeAlbum?.has_cover
    ? albumCoverApiUrl(
        {
          globalAlbumUid: activeAlbum.global_album_uid,
          albumName: activeAlbum.name,
          artistName: activeAlbum.artist_name,
        },
        { size: 256 },
      )
    : null;
  const hasAlbums = crate.album_count > 0;
  const ownerName = crateOwnerName(crate);
  const albumCountLabel = t("common.albumCountLabel", {
    count: crate.album_count,
  });
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: crate.name,
      subtitle: ownerName ?? undefined,
      detail: albumCountLabel,
      imageUrl: cover ?? undefined,
      imageAlt: crate.name,
      imageShape: "square",
      fallbackIcon: Disc3,
    }),
    [albumCountLabel, cover, crate.name, ownerName],
  );
  const actionMenu = useCrateActionMenu(
    {
      crate,
      onPlay: hasAlbums ? onPlay : undefined,
      onShuffle: hasAlbums ? onShuffle : undefined,
      onEdit,
      onStartRadio: hasAlbums ? onStartRadio : undefined,
      onMakeAvailableOffline: hasAlbums ? onMakeAvailableOffline : undefined,
      onDownload: hasAlbums ? onDownload : undefined,
      onShare: () => {
        if (!isShareableCrate(crate)) return;
        openShareSheet(buildCrateSharePayload(crate, albums));
      },
      onToggleFollow: canFollow ? crateFollow.toggle : undefined,
      followed: crateFollow.followed,
      followPending: crateFollow.pending,
      offlineActionLabel,
      offlineActionDisabled,
      offlineActionActive,
    },
    header,
  );

  return {
    t,
    albums,
    activeIndex,
    setActiveIndex,
    activeAlbum,
    canFollow,
    cover,
    hasAlbums,
    ownerName,
    actionMenu,
    subtitle: `${albumCountLabel} · ${t("common.trackCountLabel", {
      count: crate.track_count,
    })}`,
    meta: `${t(crateAccessLabelKey(crate))}${
      canFollow && ownerName ? ` · ${ownerName}` : ""
    }`,
  };
}

function CrateCover({
  src,
  alt,
  iconSize,
}: {
  src: string | null;
  alt: string;
  iconSize: number;
}) {
  return src ? (
    <CrateImage
      src={src}
      alt={alt}
      loading="lazy"
      className="size-full object-cover"
    />
  ) : (
    <div className="flex size-full items-center justify-center text-accent-action/70">
      <Disc3 size={iconSize} />
    </div>
  );
}

function CrateTile(props: CrateCardProps) {
  const { crate, onPlay, layout = "rail" } = props;
  const model = useCrateCardModel(props);
  const { t, albums, activeIndex, setActiveIndex, activeAlbum } = model;
  const albumCount = albums.length;
  const loop = crate.loop_enabled;
  const moveActiveAlbum = useCallback(
    (delta: number) => {
      if (albumCount === 0) return;
      setActiveIndex((index) => {
        const nextIndex = index + delta;
        if (loop) return (nextIndex + albumCount) % albumCount;
        return Math.max(0, Math.min(albumCount - 1, nextIndex));
      });
    },
    [albumCount, loop, setActiveIndex],
  );
  const onPlayRef = useRef(onPlay);
  useEffect(() => {
    onPlayRef.current = onPlay;
  });
  const canPlay = model.hasAlbums && Boolean(onPlay);
  const playLabel = t("library.crates.play", { name: crate.name });
  const overlay = useMemo<EntityCardOverlay | undefined>(
    () =>
      canPlay
        ? { onPlay: () => void onPlayRef.current?.(), playLabel }
        : undefined,
    [canPlay, playLabel],
  );

  return (
    <div
      data-testid="crate-card"
      className={cn(
        "group/card relative",
        layout === "rail" ? "w-[160px] shrink-0 snap-start" : "w-full min-w-0",
      )}
    >
      <EntityCard
        title={crate.name}
        subtitle={model.subtitle}
        meta={model.meta}
        layout="grid"
        href={cratePagePath(crate)}
        openLabel={t("library.crates.open", { name: crate.name })}
        menuLabel={t("actions.menu.more")}
        actionMenu={model.actionMenu}
        overlay={overlay}
        artwork={
          <span
            key={activeAlbum?.global_album_uid ?? "empty"}
            className="block size-full animate-hero-fade-in"
          >
            <CrateCover
              src={model.cover}
              alt={activeAlbum?.name ?? ""}
              iconSize={28}
            />
          </span>
        }
        artworkOverlay={
          <>
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
            {crate.visibility === "private" ? (
              <span
                data-testid="crate-visibility"
                role="img"
                aria-label={t("library.crates.private")}
                className="pointer-events-none absolute right-2 top-2 z-10 flex items-center rounded-full border border-white/15 bg-black/45 p-2 text-white backdrop-blur-md"
              >
                <Lock size={12} aria-hidden="true" />
              </span>
            ) : null}
            {crate.is_ordered && activeAlbum ? (
              <span className="pointer-events-none absolute bottom-1 right-2 text-5xl font-black leading-none tracking-[-0.08em] text-white/25">
                <span className="sr-only">
                  {t("stats.rank", { rank: activeAlbum.displayNumber })}
                </span>
                {String(activeAlbum.displayNumber).padStart(2, "0")}
              </span>
            ) : null}
          </>
        }
      />
      {albumCount > 1 ? (
        <div className="pointer-events-none absolute inset-x-[var(--content-card-padding)] top-[var(--content-card-padding)] z-20 aspect-square">
          <button
            type="button"
            aria-label={t("library.crates.previousAlbum")}
            disabled={!loop && activeIndex === 0}
            onClick={() => moveActiveAlbum(-1)}
            className={cn(ARROW_CLASS_NAME, "left-2")}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label={t("library.crates.nextAlbum")}
            disabled={!loop && activeIndex === albumCount - 1}
            onClick={() => moveActiveAlbum(1)}
            className={cn(ARROW_CLASS_NAME, "right-2")}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CrateRow(props: CrateCardProps) {
  const { crate } = props;
  const model = useCrateCardModel(props);

  return (
    <EntityRow
      title={crate.name}
      subtitle={model.subtitle}
      meta={model.meta}
      leading={
        <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-text-primary/5">
          <CrateCover src={model.cover} alt="" iconSize={18} />
        </span>
      }
      titleAccessory={
        crate.visibility === "private" ? (
          <Lock
            size={12}
            role="img"
            aria-label={model.t("library.crates.private")}
            className="shrink-0 text-text-muted"
          />
        ) : null
      }
      href={cratePagePath(crate)}
      openLabel={model.t("library.crates.open", { name: crate.name })}
      menuLabel={model.t("actions.menu.more")}
      actionMenu={model.actionMenu}
    />
  );
}

export const CrateCard = memo(function CrateCard({
  variant = "tile",
  ...props
}: CrateCardProps) {
  return variant === "row" ? <CrateRow {...props} /> : <CrateTile {...props} />;
});
