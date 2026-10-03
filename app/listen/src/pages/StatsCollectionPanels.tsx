import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Disc3, Flame, Music2 } from "@crate/ui/icons";
import { Link } from "react-router";

import { CrateImage } from "@/components/artwork/CrateImage";
import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
  useItemActionTarget,
} from "@/components/actions/ItemActionMenu";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import type { PlaySource } from "@/contexts/PlayerContext";
import {
  formatStatsMinutes,
  type StatsAlbum,
  type StatsArtist,
  type StatsTrack,
} from "@/components/stats/stats-model";
import { artistPhotoApiUrl, artistPagePath } from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import {
  statsAlbumKey,
  statsArtistKey,
  statsTrackKey,
} from "./stats-collection-keys";

export function StatsPlayMeta({
  playCount,
  minutes,
}: {
  playCount: number;
  minutes: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      {t("common.playCount", { count: playCount })} ·{" "}
      {formatStatsMinutes(minutes)}
    </>
  );
}

export function TopTracksPanel({
  items,
  rows,
  loading,
  playSource,
}: {
  items: StatsTrack[];
  rows: TrackRowData[];
  loading: boolean;
  playSource: PlaySource;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topTracks.title")}
      subtitle={t("stats.topTracks.subtitle")}
      icon={Music2}
    >
      <div className="space-y-1">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items.map((item, index) => (
            <TrackRow
              key={statsTrackKey(item)}
              track={rows[index]!}
              rank={index + 1}
              showCoverThumb
              showArtist
              showAlbum
              showDuration={false}
              queueTracks={rows}
              playSource={playSource}
              meta={
                <StatsPlayMeta
                  playCount={item.play_count}
                  minutes={item.minutes_listened}
                />
              }
            />
          ))
        ) : (
          <PanelEmpty text={t("stats.topTracks.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

export function TopArtistsPanel({
  items,
  loading,
}: {
  items: StatsArtist[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topArtists.title")}
      subtitle={t("stats.topArtists.subtitle")}
      icon={Flame}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items
            .slice(0, 6)
            .map((item, index) => (
              <TopArtistCard
                key={statsArtistKey(item)}
                item={item}
                index={index}
              />
            ))
        ) : (
          <PanelEmpty text={t("stats.topArtists.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

function TopArtistCard({ item, index }: { item: StatsArtist; index: number }) {
  const { t } = useTranslation();
  const photo = artistPhotoApiUrl(
    {
      artistId: item.artist_id,
      globalArtistUid: item.global_artist_uid,
      artistSlug: item.artist_slug,
      artistName: item.artist_name,
    },
    { size: 640 },
  );
  const actions = useArtistActionEntries({
    artistId: item.artist_id ?? undefined,
    globalArtistUid: item.global_artist_uid ?? undefined,
    artistSlug: item.artist_slug ?? undefined,
    imageUrl: photo,
    name: item.artist_name,
  });
  const actionMenu = useItemActionMenu(actions);
  const actionTarget = useItemActionTarget(actionMenu);

  return (
    <article className="item-action-target group relative" {...actionTarget}>
      <Link
        to={artistPagePath({
          artistId: item.artist_id,
          globalArtistUid: item.global_artist_uid,
          artistSlug: item.artist_slug,
          artistName: item.artist_name,
        })}
        className="stats-artist-card group relative block min-h-40 overflow-hidden rounded-xl p-4 transition"
      >
        {photo ? (
          <CrateImage
            src={photo}
            alt=""
            className="absolute inset-0 size-full object-cover grayscale opacity-55 transition duration-500 group-hover:scale-105 group-hover:opacity-70"
            loading="lazy"
          />
        ) : (
          <div className="stats-artist-placeholder absolute inset-0" />
        )}
        <div className="stats-artist-overlay absolute inset-0" />
        <div className="stats-artist-index absolute -bottom-6 -right-1 text-[8.5rem] font-black leading-none tracking-[-0.12em]">
          {String(index + 1).padStart(2, "0")}
        </div>
        <div className="relative z-10 flex min-h-32 flex-col justify-between">
          <div className="text-xs font-black uppercase tracking-[0.22em] text-accent-action">
            {t("stats.rank", { rank: index + 1 })}
          </div>
          <div>
            <div className="stats-artist-title line-clamp-2 text-3xl font-black uppercase leading-[0.86] tracking-[-0.08em]">
              {item.artist_name}
            </div>
            <div className="stats-artist-meta mt-3 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.12em]">
              <span>{t("common.playCount", { count: item.play_count })}</span>
              <span>{formatStatsMinutes(item.minutes_listened)}</span>
            </div>
          </div>
        </div>
      </Link>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="absolute right-2 top-2 z-20 size-9 opacity-75 transition-opacity hover:opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: item.artist_name,
          imageUrl: photo,
          imageAlt: item.artist_name,
          imageShape: "circle",
          fallbackIcon: Flame,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </article>
  );
}

export function TopAlbumsPanel({
  items,
  loading,
}: {
  items: StatsAlbum[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topAlbums.title")}
      subtitle={t("stats.topAlbums.subtitle")}
      icon={Disc3}
      className="mt-8"
    >
      {loading ? (
        <PanelLoading />
      ) : items.length ? (
        <div
          data-testid="stats-top-albums-grid"
          className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6"
        >
          {items.slice(0, 12).map((item, index) => (
            <AlbumCard
              key={statsAlbumKey(item)}
              layout="grid"
              rank={index + 1}
              artist={item.artist}
              album={item.album}
              albumId={item.album_id ?? undefined}
              globalAlbumUid={item.global_album_uid ?? undefined}
              albumSlug={item.album_slug ?? undefined}
              artistSlug={item.artist_slug ?? undefined}
              meta={
                <StatsPlayMeta
                  playCount={item.play_count}
                  minutes={item.minutes_listened}
                />
              }
            />
          ))}
        </div>
      ) : (
        <PanelEmpty text={t("stats.topAlbums.empty")} />
      )}
    </StatsPanel>
  );
}

function StatsPanel({
  title,
  subtitle,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("stats-card min-w-0 rounded-[12px] p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-text-primary">
            {title}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
        </div>
        <Icon className="text-accent-action" size={22} />
      </div>
      {children}
    </section>
  );
}

export function PanelLoading() {
  const { t } = useTranslation();
  return (
    <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
      {t("common.loadingShort")}
    </div>
  );
}

export function PanelEmpty({ text }: { text: string }) {
  return (
    <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
      {text}
    </div>
  );
}
