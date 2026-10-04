import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Clock, Disc } from "@crate/ui/icons";
import { PageHero } from "@crate/ui/domain/hero";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";

import { AlbumHeroContributor } from "@/components/album/AlbumHeroContributor";
import { ReleaseCountdown } from "@/components/album/ReleaseCountdown";
import { CrateImage } from "@/components/artwork/CrateImage";
import { QualityBadge } from "@/components/player/bar/QualityBadge";
import type { QualityBadge as QualityBadgeData } from "@/components/player/bar/player-bar-utils";
import type { OfflineItemState } from "@/lib/offline";
import { cn, formatTotalDuration } from "@/lib/utils";
import type { AlbumData, AlbumContributor } from "@/pages/album-types";

function hideBrokenImage(event: React.SyntheticEvent<HTMLImageElement>) {
  (event.target as HTMLImageElement).style.display = "none";
}

export function AlbumHero({
  data,
  coverUrl,
  artistPhotoUrl,
  displayName,
  isPreRelease,
  canPersistAlbum,
  offlineState,
  year,
  genre,
  playerTrackCount,
  qualityBadges,
  visibleContributor,
  primaryContributorName,
  primaryContributorPath,
  primaryContributorSource,
  albumHeroInfoRef,
  actions,
  onArtistNavigate,
  onGenreSelect,
  t,
}: {
  data: AlbumData;
  coverUrl: string;
  artistPhotoUrl: string;
  displayName: string;
  isPreRelease: boolean;
  canPersistAlbum: boolean;
  offlineState: OfflineItemState;
  year?: string;
  genre?: string;
  playerTrackCount: number;
  qualityBadges: QualityBadgeData[];
  visibleContributor: AlbumContributor | null;
  primaryContributorName: string | null;
  primaryContributorPath: string | null;
  primaryContributorSource: string | null;
  albumHeroInfoRef: RefObject<HTMLDivElement | null>;
  actions: ReactNode;
  onArtistNavigate: () => void;
  onGenreSelect: (item: GenreProfileItem) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { i18n } = useTranslation();
  const hasCover = Boolean(data.has_cover || data.cover_url);

  return (
    <PageHero
      variant="media"
      className="h-auto min-h-[520px] sm:h-[430px] sm:min-h-0 lg:h-[460px]"
      contentClassName="translate-y-[var(--album-mobile-info-y)] pb-[calc(var(--album-mobile-action-overlap)+var(--album-mobile-info-action-gap))] pt-[var(--listen-mobile-page-top)] sm:translate-y-0 sm:pb-6"
      artworkClassName="block w-[200px] self-center bg-transparent shadow-none ring-0 sm:w-[240px] sm:self-auto sm:bg-text-primary/5 sm:shadow-2xl sm:ring-1 lg:w-[280px]"
      titleClassName="max-w-4xl text-2xl"
      actionsClassName="-mt-[var(--album-mobile-action-overlap)] pt-0 sm:mt-0"
      background={
        hasCover
          ? {
              render: (className) => (
                <CrateImage
                  data-testid="album-hero-background"
                  src={coverUrl}
                  alt=""
                  className={cn(
                    className,
                    "scale-[1.04] sm:brightness-[0.42] sm:opacity-[0.42]",
                  )}
                  onError={hideBrokenImage}
                />
              ),
            }
          : { src: null }
      }
      artwork={
        <>
          <div
            data-testid="album-mobile-cover-spacer"
            aria-hidden="true"
            className="aspect-square sm:hidden"
          />
          <div
            data-testid="album-desktop-cover"
            className="hidden size-full sm:block"
          >
            {hasCover ? (
              <CrateImage
                src={coverUrl}
                alt={displayName}
                className="size-full object-cover"
                onError={hideBrokenImage}
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <Disc size={64} className="text-text-primary/10" />
              </div>
            )}
          </div>
        </>
      }
      eyebrow={
        isPreRelease || canPersistAlbum ? (
          <>
            {isPreRelease ? (
              <span className="rounded-full border border-accent-action/20 bg-accent-action/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent-action">
                {t("radar.release.preRelease")}
              </span>
            ) : null}
            {canPersistAlbum ? <OfflineBadge state={offlineState} /> : null}
          </>
        ) : null
      }
      title={displayName}
      subtitle={
        <button
          type="button"
          className="link-meta inline-flex items-center gap-2 self-start text-sm"
          onClick={onArtistNavigate}
        >
          <span className="size-6 shrink-0 overflow-hidden rounded-full bg-text-primary/5">
            <CrateImage
              src={artistPhotoUrl}
              alt={data.artist}
              className="size-full object-cover"
              onError={hideBrokenImage}
            />
          </span>
          {data.artist}
        </button>
      }
      meta={[
        year ? <span key="year">{year}</span> : null,
        isPreRelease && data.release_date ? (
          <span key="release">
            {t("album.card.releasesOn", {
              date: new Date(
                `${data.release_date}T12:00:00`,
              ).toLocaleDateString(i18n.language, {
                month: "long",
                day: "numeric",
                year: "numeric",
              }),
            })}
          </span>
        ) : null,
        !data.genre_profile?.length && genre ? (
          <span key="genre" className="hidden sm:inline">
            {genre}
          </span>
        ) : null,
        data.track_count > 0
          ? t("common.trackCountLabel", { count: data.track_count })
          : null,
        isPreRelease
          ? t("album.hero.availableNow", { count: playerTrackCount })
          : null,
        data.total_length_sec > 0 ? (
          <span key="duration" className="flex items-center gap-1">
            <Clock size={11} />
            {formatTotalDuration(data.total_length_sec)}
          </span>
        ) : null,
        ...qualityBadges.map((badge) => (
          <QualityBadge key={badge.tier + "-" + badge.label} badge={badge} />
        )),
      ]}
      actions={actions}
    >
      <div ref={albumHeroInfoRef} data-testid="album-hero-info">
        {isPreRelease && data.release_date ? (
          <ReleaseCountdown releaseDate={data.release_date} />
        ) : null}
        <AlbumHeroContributor
          data={data}
          visibleContributor={visibleContributor}
          primaryContributorName={primaryContributorName}
          primaryContributorPath={primaryContributorPath}
          primaryContributorSource={primaryContributorSource}
          onGenreSelect={onGenreSelect}
        />
      </div>
    </PageHero>
  );
}
