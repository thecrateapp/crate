import { useEffect, useMemo, useState } from "react";
import { CoverFlow, type RenderImageProps } from "@ashishgogula/coverflow";
import { ChevronLeft, ChevronRight, Play } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl } from "@/lib/library-routes";
import type { CrateAlbum } from "@/pages/crates-types";

interface CrateCoverFlowProps {
  albums: CrateAlbum[];
  isOrdered: boolean;
  sortDirection: "asc" | "desc";
  crateName?: string;
  canPlay?: boolean;
  loopEnabled?: boolean;
  onPlay?: (album: CrateAlbum) => void;
}

function orderAlbums(
  albums: CrateAlbum[],
  isOrdered: boolean,
  sortDirection: "asc" | "desc",
): CrateAlbum[] {
  return [...albums].sort((left, right) => {
    const position = left.position - right.position;
    if (!isOrdered || position === 0) return position;
    return sortDirection === "desc" ? -position : position;
  });
}

export function CrateCoverFlow({
  albums,
  isOrdered,
  sortDirection,
  crateName = "crate",
  canPlay = true,
  loopEnabled = false,
  onPlay,
}: CrateCoverFlowProps) {
  const { t } = useTranslation();
  const orderedAlbums = useMemo(
    () => orderAlbums(albums, isOrdered, sortDirection),
    [albums, isOrdered, sortDirection],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAlbum = orderedAlbums[activeIndex] ?? orderedAlbums[0] ?? null;
  const items = orderedAlbums.map((album) => ({
    id: album.global_album_uid,
    image: album.has_cover
      ? albumCoverApiUrl(
          {
            globalAlbumUid: album.global_album_uid,
            albumName: album.name,
            artistName: album.artist_name,
          },
          { size: 768 },
        )
      : `/icons/icon-512.png#${encodeURIComponent(album.global_album_uid)}`,
    title: album.name,
    subtitle: album.artist_name,
  }));
  const isLoopingCoverFlow = loopEnabled && orderedAlbums.length > 1;
  const flowItems = isLoopingCoverFlow
    ? [0, 1, 2].flatMap((copy) =>
        items.map((item) => ({ ...item, id: `${item.id}-${copy}` })),
      )
    : items;
  const flowIndex = isLoopingCoverFlow
    ? orderedAlbums.length + activeIndex
    : activeIndex;

  function moveActiveIndex(delta: number) {
    setActiveIndex((index) => {
      const nextIndex = index + delta;
      if (loopEnabled) {
        return (nextIndex + orderedAlbums.length) % orderedAlbums.length;
      }
      return Math.max(0, Math.min(orderedAlbums.length - 1, nextIndex));
    });
  }

  useEffect(() => {
    if (orderedAlbums.length === 0 || activeIndex < orderedAlbums.length) {
      return;
    }
    setActiveIndex(orderedAlbums.length - 1);
  }, [activeIndex, orderedAlbums.length]);

  if (orderedAlbums.length === 0) return null;

  function renderImage(props: RenderImageProps) {
    const activeRankIndex = props.alt
      ? flowItems.findIndex(
          (item) => item.image === props.src && item.title === props.alt,
        ) % orderedAlbums.length
      : -1;
    const rank =
      activeRankIndex >= 0
        ? (orderedAlbums[activeRankIndex]?.position ?? activeRankIndex) + 1
        : -1;
    return (
      <div className="relative size-full overflow-hidden rounded-xl bg-text-primary/5">
        <CrateImage
          src={props.src}
          alt={props.alt}
          width={props.width}
          height={props.height}
          className={props.className}
          draggable={props.draggable}
          sizes={props.sizes}
          loading={props.loading}
        />
        {isOrdered && rank >= 0 ? (
          <span className="pointer-events-none absolute bottom-0 right-2 text-[7rem] font-black leading-none tracking-[-0.08em] text-white/25">
            <span className="sr-only">{t("stats.rank", { rank })}</span>
            {String(rank).padStart(2, "0")}
          </span>
        ) : null}
      </div>
    );
  }

  function handleCoverFlowIndexChange(index: number) {
    if (!isLoopingCoverFlow) {
      setActiveIndex(index);
      return;
    }
    setActiveIndex(
      (((index - orderedAlbums.length) % orderedAlbums.length) +
        orderedAlbums.length) %
        orderedAlbums.length,
    );
  }

  const activeItem = items[activeIndex] ?? items[0];
  const fallbackCover = activeItem ? (
    <div className="relative mx-auto aspect-square w-full max-w-[22rem] overflow-hidden rounded-xl bg-text-primary/5">
      <CrateImage
        src={activeItem.image}
        alt={activeItem.title}
        width={360}
        height={360}
        className="size-full object-cover"
      />
      {isOrdered ? (
        <span className="pointer-events-none absolute bottom-0 right-2 text-[7rem] font-black leading-none tracking-[-0.08em] text-white/25">
          <span className="sr-only">
            {t("stats.rank", {
              rank: (activeAlbum?.position ?? activeIndex) + 1,
            })}
          </span>
          {String((activeAlbum?.position ?? activeIndex) + 1).padStart(2, "0")}
        </span>
      ) : null}
    </div>
  ) : null;

  return (
    <section
      aria-label={crateName}
      className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-border-quiet bg-text-primary/[0.025] px-3 pb-5 pt-3 sm:px-6"
    >
      <div className="relative min-h-[19rem] sm:min-h-[25rem]">
        {typeof ResizeObserver === "undefined" ? (
          fallbackCover
        ) : (
          <CoverFlow
            key={flowIndex}
            items={flowItems}
            itemWidth={360}
            itemHeight={360}
            stackSpacing={92}
            centerGap={220}
            rotation={48}
            initialIndex={flowIndex}
            enableReflection={false}
            enableClickToSnap
            enableScroll
            enableAudio={false}
            onIndexChange={handleCoverFlowIndexChange}
            renderImage={renderImage}
            className="h-[19rem] sm:h-[25rem]"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label={t("library.crates.previousAlbum")}
            disabled={!loopEnabled && activeIndex === 0}
            onClick={() => moveActiveIndex(-1)}
            className="pointer-events-auto flex size-9 items-center justify-center rounded-full border border-border-quiet bg-surface-canvas/80 text-text-primary transition hover:bg-text-primary/10 disabled:opacity-30"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label={t("library.crates.play", { name: crateName })}
            disabled={!canPlay}
            onClick={() => {
              if (canPlay && activeAlbum) onPlay?.(activeAlbum);
            }}
            className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-lg transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play size={20} fill="currentColor" />
          </button>
          <button
            type="button"
            aria-label={t("library.crates.nextAlbum")}
            disabled={!loopEnabled && activeIndex === orderedAlbums.length - 1}
            onClick={() => moveActiveIndex(1)}
            className="pointer-events-auto flex size-9 items-center justify-center rounded-full border border-border-quiet bg-surface-canvas/80 text-text-primary transition hover:bg-text-primary/10 disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="mt-2 text-center">
        <p className="truncate text-lg font-semibold text-text-primary">
          {activeAlbum?.name}
        </p>
        <p className="truncate text-sm text-text-muted">
          {activeAlbum?.artist_name}
          {activeAlbum?.year ? ` · ${activeAlbum.year}` : ""}
        </p>
      </div>
    </section>
  );
}

export { orderAlbums };
