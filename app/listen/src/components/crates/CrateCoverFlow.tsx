import { useEffect, useMemo, useRef, useState } from "react";
import { CoverFlow, type RenderImageProps } from "@ashishgogula/coverflow";
import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { NumberedCrateAlbum } from "@/components/crates/crate-model";
import { albumCoverApiUrl } from "@/lib/library-routes";

export type CrateCoverUrl = (
  album: NumberedCrateAlbum,
  size: number,
) => string | null;

interface CrateCoverFlowProps {
  albums: NumberedCrateAlbum[];
  isOrdered: boolean;
  crateName: string;
  loopEnabled?: boolean;
  coverUrl?: CrateCoverUrl;
}

const LOOP_COPIES = 3;

export function authenticatedCrateCoverUrl(
  album: NumberedCrateAlbum,
  size: number,
): string | null {
  if (!album.has_cover) return null;
  return albumCoverApiUrl(
    {
      globalAlbumUid: album.global_album_uid,
      albumName: album.name,
      artistName: album.artist_name,
    },
    { size },
  );
}

function wrapIndex(index: number, length: number) {
  return ((index % length) + length) % length;
}

function RankOverlay({ number }: { number: number }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="crate-rank-badge"
      className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-artwork-scrim/60 px-2.5 py-1 text-3xl font-black leading-none tabular-nums tracking-tight text-artwork-foreground shadow-lg backdrop-blur-sm sm:bottom-4 sm:right-4 sm:text-4xl"
    >
      <span className="sr-only">{t("stats.rank", { rank: number })}</span>
      {String(number).padStart(2, "0")}
    </span>
  );
}

export function CrateCoverFlow({
  albums,
  isOrdered,
  crateName,
  loopEnabled = false,
  coverUrl = authenticatedCrateCoverUrl,
}: CrateCoverFlowProps) {
  const { t } = useTranslation();
  const albumCount = albums.length;
  const isLooping = loopEnabled && albumCount > 1;
  const [flowIndex, setFlowIndex] = useState(() => {
    if (isLooping) return albumCount;
    return isOrdered ? 0 : Math.floor(Math.max(albumCount - 1, 0) / 2);
  });
  const flowRef = useRef<HTMLDivElement>(null);
  const images = useMemo(
    () =>
      albums.map(
        (album) =>
          coverUrl(album, 768) ??
          `/icons/icon-512.png#${encodeURIComponent(album.global_album_uid)}`,
      ),
    [albums, coverUrl],
  );
  const flowItems = useMemo(() => {
    const copies = isLooping ? LOOP_COPIES : 1;
    return Array.from({ length: copies }).flatMap((_, copy) =>
      albums.map((album, index) => ({
        id: `${album.global_album_uid}-${copy}`,
        image: images[index] ?? "",
        title: "",
      })),
    );
  }, [albums, images, isLooping]);
  const safeFlowIndex = isLooping
    ? Math.min(Math.max(flowIndex, 0), flowItems.length - 1)
    : Math.min(Math.max(flowIndex, 0), Math.max(albumCount - 1, 0));
  const activeIndex = albumCount > 0 ? wrapIndex(safeFlowIndex, albumCount) : 0;
  const activeAlbum = albums[activeIndex] ?? null;
  const flowLabel = t("crate.coverflow.label", { name: crateName });

  useEffect(() => {
    flowRef.current
      ?.querySelector('[role="region"]')
      ?.setAttribute("aria-label", flowLabel);
  }, [flowLabel, albumCount]);

  if (albumCount === 0 || !activeAlbum) return null;

  function renderImage(props: RenderImageProps) {
    const album = albums[images.indexOf(props.src)];
    return (
      <div className="relative size-full overflow-hidden rounded-xl bg-text-primary/5">
        <CrateImage
          src={props.src}
          alt={album ? `${album.name} - ${album.artist_name}` : ""}
          width={props.width}
          height={props.height}
          className={props.className}
          draggable={props.draggable}
          sizes={props.sizes}
          loading={props.loading}
        />
        {isOrdered && album ? (
          <RankOverlay number={album.displayNumber} />
        ) : null}
      </div>
    );
  }

  function handleIndexChange(index: number) {
    if (!isLooping) {
      setFlowIndex(index);
      return;
    }
    const atEdge = index <= 0 || index >= flowItems.length - 1;
    setFlowIndex(atEdge ? albumCount + wrapIndex(index, albumCount) : index);
  }

  const fallbackImage = images[activeIndex] ?? "";

  return (
    <div className="relative mx-auto w-full max-w-3xl px-0 pb-2 pt-0 sm:px-2">
      <div
        ref={flowRef}
        data-testid="crate-coverflow-frame"
        className="relative h-[19rem] overflow-hidden sm:h-[25rem] [&_h3:empty]:hidden"
      >
        {typeof ResizeObserver === "undefined" ? (
          <div className="relative mx-auto aspect-square h-full max-w-full overflow-hidden rounded-xl bg-text-primary/5">
            <CrateImage
              src={fallbackImage}
              alt={`${activeAlbum.name} - ${activeAlbum.artist_name}`}
              width={360}
              height={360}
              className="size-full object-cover"
            />
            {isOrdered ? (
              <RankOverlay number={activeAlbum.displayNumber} />
            ) : null}
          </div>
        ) : (
          <CoverFlow
            items={flowItems}
            itemWidth={360}
            itemHeight={360}
            stackSpacing={92}
            centerGap={220}
            rotation={48}
            initialIndex={safeFlowIndex}
            enableReflection={false}
            enableClickToSnap
            enableScroll
            enableAudio={false}
            onIndexChange={handleIndexChange}
            renderImage={renderImage}
          />
        )}
      </div>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="mt-3 min-h-11 px-4 text-center"
      >
        <span className="sr-only">
          {t("crate.coverflow.position", {
            index: activeIndex + 1,
            count: albumCount,
          })}
        </span>
        <p className="truncate text-base font-semibold text-text-primary">
          {activeAlbum.name}
        </p>
        <p className="truncate text-sm text-text-muted">
          {activeAlbum.artist_name}
        </p>
      </div>
    </div>
  );
}
