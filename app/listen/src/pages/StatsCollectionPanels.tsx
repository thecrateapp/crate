import { MediaGrid } from "@crate/ui/domain/lists";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Flame } from "@crate/ui/icons";
import { Link } from "react-router";

import { CrateImage } from "@/components/artwork/CrateImage";
import { UserAvatar } from "@/components/social/UserAvatar";
import {
  ItemActionMenu,
  ItemActionMenuButton,
  type ItemActionMenuEntry,
  type UseItemActionMenuReturn,
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
  type StatsTopListener,
  type StatsTrack,
} from "@/components/stats/stats-model";
import { artistPhotoApiUrl, artistPagePath } from "@/lib/library-routes";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import { StatsArtistRankView } from "./StatsArtistRankView";
import { StatsPanel } from "./StatsPageView";

import {
  statsAlbumKey,
  statsArtistKey,
  statsTrackKey,
} from "./stats-collection-keys";

import { StatsPlayMeta } from "../components/stats/StatsPlayMeta";
export { StatsPlayMeta } from "../components/stats/StatsPlayMeta";

const NO_ACTIONS: ItemActionMenuEntry[] = [];

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
    >
      <div className="space-y-1">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items.map((item, index) => (
            <TopTrackRow
              key={statsTrackKey(item)}
              item={item}
              track={rows[index]!}
              rank={index + 1}
              queueTracks={rows}
              playSource={playSource}
            />
          ))
        ) : (
          <PanelEmpty text={t("stats.topTracks.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

function TopTrackRow({
  item,
  track,
  rank,
  queueTracks,
  playSource,
}: {
  item: StatsTrack;
  track: TrackRowData;
  rank: number;
  queueTracks: TrackRowData[];
  playSource: PlaySource;
}) {
  const {
    play_count: playCount,
    minutes_listened: minutes,
    is_new: isNew,
  } = item;
  const meta = useMemo(
    () => (
      <StatsPlayMeta playCount={playCount} minutes={minutes} isNew={isNew} />
    ),
    [playCount, minutes, isNew],
  );
  return (
    <TrackRow
      track={track}
      rank={rank}
      showCoverThumb
      showArtist
      showAlbum
      queueTracks={queueTracks}
      playSource={playSource}
      meta={meta}
    />
  );
}

const TOP_ARTISTS_LIMIT = 10;

/** Keep the ranking complete even when #1 also appears in the hero. */
function visibleTopArtists(items: StatsArtist[]) {
  return items
    .slice(0, TOP_ARTISTS_LIMIT)
    .map((item, index) => ({ item, index }));
}

export function TopArtistsPanel({
  items,
  loading,
  totalMinutes = 0,
}: {
  items: StatsArtist[];
  loading: boolean;
  /** Period total (overview.minutes_listened) the share bars divide by. */
  totalMinutes?: number;
}) {
  const { t } = useTranslation();
  const visible = useMemo(() => visibleTopArtists(items), [items]);
  return (
    <StatsPanel
      title={t("stats.topArtists.title")}
      subtitle={t("stats.topArtists.subtitle")}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {loading ? (
          <PanelLoading />
        ) : visible.length ? (
          visible.map(({ item, index }) => (
            <TopArtistCard
              key={statsArtistKey(item)}
              item={item}
              index={index}
              totalMinutes={totalMinutes}
            />
          ))
        ) : (
          <PanelEmpty text={t("stats.topArtists.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

function TopArtistCard({
  item,
  index,
  totalMinutes,
}: {
  item: StatsArtist;
  index: number;
  totalMinutes: number;
}) {
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
  const actionMenu = useItemActionMenu(NO_ACTIONS, { hasActions: true });
  const actionTarget = useItemActionTarget(actionMenu);

  return (
    <article className="item-action-target group relative" {...actionTarget}>
      <StatsArtistRankView
        item={item}
        index={index}
        share={totalMinutes > 0 ? item.minutes_listened / totalMinutes : null}
        href={artistPagePath({
          artistId: item.artist_id,
          globalArtistUid: item.global_artist_uid,
          artistSlug: item.artist_slug,
          artistName: item.artist_name,
        })}
        artwork={
          photo ? (
            <CrateImage
              src={photo}
              alt=""
              className="absolute inset-0 size-full object-cover grayscale opacity-55 transition duration-500 motion-reduce:transition-none group-hover:scale-105 group-hover:opacity-70"
              loading="lazy"
            />
          ) : (
            <div className="stats-artist-placeholder absolute inset-0" />
          )
        }
      />
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        expanded={actionMenu.open}
        title={t("actions.menu.more")}
        className="absolute right-2 top-2 z-20 size-9 opacity-75 transition-opacity hover:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
      />
      {actionMenu.open ? (
        <TopArtistCardMenu actionMenu={actionMenu} item={item} photo={photo} />
      ) : null}
    </article>
  );
}

function TopArtistCardMenu({
  actionMenu,
  item,
  photo,
}: {
  actionMenu: UseItemActionMenuReturn;
  item: StatsArtist;
  photo: string;
}) {
  const actions = useArtistActionEntries({
    artistId: item.artist_id ?? undefined,
    globalArtistUid: item.global_artist_uid ?? undefined,
    artistSlug: item.artist_slug ?? undefined,
    imageUrl: photo,
    name: item.artist_name,
  });

  return (
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
  );
}

function albumRowFillClass(index: number): string | undefined {
  if (index >= 12) return "sm:hidden 2xl:block";
  if (index >= 10) return "lg:hidden xl:block";
  return undefined;
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
    >
      {loading ? (
        <PanelLoading />
      ) : items.length ? (
        <MediaGrid>
          {items.slice(0, 14).map((item, index) => (
            <div key={statsAlbumKey(item)} className={albumRowFillClass(index)}>
              <TopAlbumCard item={item} rank={index + 1} />
            </div>
          ))}
        </MediaGrid>
      ) : (
        <PanelEmpty text={t("stats.topAlbums.empty")} />
      )}
    </StatsPanel>
  );
}

function TopAlbumCard({ item, rank }: { item: StatsAlbum; rank: number }) {
  const {
    play_count: playCount,
    minutes_listened: minutes,
    is_new: isNew,
  } = item;
  const meta = useMemo(
    () => (
      <StatsPlayMeta playCount={playCount} minutes={minutes} isNew={isNew} />
    ),
    [playCount, minutes, isNew],
  );
  return (
    <AlbumCard
      layout="grid"
      rank={rank}
      artist={item.artist}
      album={item.album}
      albumId={item.album_id ?? undefined}
      globalAlbumUid={item.global_album_uid ?? undefined}
      albumSlug={item.album_slug ?? undefined}
      artistSlug={item.artist_slug ?? undefined}
      meta={meta}
    />
  );
}

export function TopListenersPanel({
  listeners,
}: {
  listeners: StatsTopListener[];
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topListeners.title")}
      subtitle={t("stats.topListeners.subtitle")}
    >
      <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {listeners.map((listener, index) => {
          const name =
            listener.display_name ||
            listener.username ||
            `#${listener.user_id}`;
          const meta = t("stats.topListeners.meta", {
            time: formatStatsMinutes(listener.minutes),
            plays: listener.plays,
          });
          const body = (
            <>
              <span className="w-6 shrink-0 text-right text-sm font-bold tabular-nums text-text-muted">
                {index + 1}
              </span>
              <UserAvatar
                name={name}
                avatar={listener.avatar}
                userId={listener.user_id}
                alt=""
                size="sm"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text-primary">
                  {name}
                </span>
                <MonoLabel as="span" className="block truncate">
                  {meta}
                </MonoLabel>
              </span>
            </>
          );
          return (
            <li key={listener.user_id}>
              {listener.username ? (
                <Link
                  to={`/users/${encodeURIComponent(listener.username)}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors "
                >
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-2 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </StatsPanel>
  );
}

export function PanelLoading() {
  const { t } = useTranslation();
  return <LoadingState label={t("common.loadingShort")} />;
}
export function PanelEmpty({ text }: { text: string }) {
  return <EmptyState message={text} />;
}
