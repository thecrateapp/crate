import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Disc3, Sparkles, UserRound } from "@crate/ui/icons";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  type ContextMenuHeader,
  type ItemActionMenuEntry,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { EditorialPlaylistArtwork } from "@/components/playlists/EditorialPlaylistArtwork";
import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import {
  SectionHeader,
  SectionRail,
  useSectionRail,
} from "@/components/home/HomeSections";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import type {
  HomeDiscoveryPayload,
  HomeListeningHistoryCard,
  HomeRecentItem,
  HomeSectionId,
} from "./home-model";

const HISTORY_TONES = [
  "home-history-tone-1",
  "home-history-tone-2",
  "home-history-tone-3",
  "home-history-tone-4",
  "home-history-tone-5",
  "home-history-tone-6",
];

function recentArtwork(item: HomeRecentItem): string | null {
  if (item.type === "playlist") return null;
  if (item.type === "artist") {
    return (
      artistPhotoApiUrl(
        {
          artistId: item.artist_id,
          artistEntityUid: item.artist_entity_uid,
          globalArtistUid: item.global_artist_uid,
          artistSlug: item.artist_slug,
          artistName: item.artist_name,
        },
        { size: 192 },
      ) || null
    );
  }
  return (
    albumCoverApiUrl(
      {
        albumId: item.album_id,
        albumEntityUid: item.album_entity_uid,
        globalAlbumUid: item.global_album_uid,
        artistEntityUid: item.artist_entity_uid,
        albumSlug: item.album_slug,
        artistName: item.artist_name,
        albumName: item.album_name,
      },
      { size: 192 },
    ) || null
  );
}

function recentTitle(item: HomeRecentItem): string {
  if (item.type === "playlist") return item.playlist_name;
  if (item.type === "artist") return item.artist_name;
  return item.album_name;
}

function recentSubtitle(item: HomeRecentItem): string | undefined {
  if (item.type === "playlist") {
    return item.playlist_description || item.subtitle;
  }
  if (item.type === "artist") return item.subtitle;
  return item.artist_name;
}

function historyLabel(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return "MY MOST LISTENED";
  return item.period_label;
}

function historyKicker(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return "Crate History";
  const date = new Date(`${item.period_start}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Listening History";
  return String(date.getFullYear());
}

function historyDisplayTitle(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return item.title;
  if (item.title !== "My Most Listened") return item.title;
  const date = new Date(`${item.period_start}T12:00:00`);
  if (Number.isNaN(date.getTime())) return item.title;
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatHistoryMinutes(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

export function RecentEntityRow({
  item,
  onClick,
}: {
  item: HomeRecentItem;
  onClick: () => void;
}) {
  if (item.type === "album") {
    return <RecentAlbumEntityRow item={item} onClick={onClick} />;
  }
  if (item.type === "artist") {
    return <RecentArtistEntityRow item={item} onClick={onClick} />;
  }
  return <RecentPlaylistEntityRow item={item} onClick={onClick} />;
}

function RecentAlbumEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "album" }>;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const actions = useAlbumActionEntries({
    artist: item.artist_name,
    artistSlug: item.artist_slug,
    artistEntityUid: item.artist_entity_uid,
    album: item.album_name,
    albumId: item.album_id,
    albumEntityUid: item.album_entity_uid,
    globalAlbumUid: item.global_album_uid,
    albumSlug: item.album_slug,
    cover: artworkUrl ?? undefined,
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.album_name,
        subtitle: item.artist_name,
        imageUrl: artworkUrl,
        imageAlt: item.album_name,
        imageShape: "square",
        fallbackIcon: Disc3,
      }}
      onClick={onClick}
    />
  );
}

function RecentArtistEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "artist" }>;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const actions = useArtistActionEntries({
    artistId: item.artist_id,
    artistEntityUid: item.artist_entity_uid,
    globalArtistUid: item.global_artist_uid,
    artistSlug: item.artist_slug,
    imageUrl: artworkUrl,
    name: item.artist_name,
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.artist_name,
        subtitle: item.subtitle,
        imageUrl: artworkUrl,
        imageAlt: item.artist_name,
        imageShape: "circle",
        fallbackIcon: UserRound,
      }}
      onClick={onClick}
    />
  );
}

function RecentPlaylistEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "playlist" }>;
  onClick: () => void;
}) {
  const actions = usePlaylistActionEntries({
    playlistId: item.playlist_id,
    name: item.playlist_name,
    isSmart: item.playlist_scope === "system",
    href: openRecentItemPath(item),
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.playlist_name,
        subtitle: item.playlist_description || item.subtitle,
        imageUrl: resolveMaybeApiAssetUrl(item.playlist_cover_data_url),
        imageAlt: item.playlist_name,
        imageShape: "square",
        fallbackIcon: Sparkles,
      }}
      onClick={onClick}
    />
  );
}

function RecentEntityRowFrame({
  item,
  actions,
  header,
  onClick,
}: {
  item: HomeRecentItem;
  actions: ItemActionMenuEntry[];
  header: ContextMenuHeader;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const title = recentTitle(item);
  const subtitle = recentSubtitle(item);
  const actionMenu = useItemActionMenu(actions);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    actionMenu.handleKeyboardTrigger(event);
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onContextMenu={actionMenu.handleContextMenu}
      className="home-discovery-card group flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left"
      {...actionMenu.longPressHandlers}
    >
      <div className="home-discovery-artwork relative h-12 w-12 shrink-0 overflow-hidden rounded-xl">
        {item.type === "playlist" ? (
          <PlaylistArtwork
            name={item.playlist_name}
            coverDataUrl={item.playlist_cover_data_url}
            tracks={item.playlist_tracks}
            className="h-full w-full rounded-xl"
          />
        ) : artworkUrl ? (
          <CrateImage
            src={artworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="home-discovery-artwork flex h-full w-full items-center justify-center">
            {item.type === "artist" ? (
              <UserRound
                size={18}
                className="home-discovery-placeholder-icon"
              />
            ) : (
              <Disc3 size={18} className="home-discovery-placeholder-icon" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-1 truncate text-xs text-text-muted">
            {subtitle}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className="h-9 w-9 opacity-75 transition-opacity hover:opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        />
      </div>

      <ItemActionMenu
        actions={actions}
        header={header}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function RecentlyPlayedSection({
  items,
  onOpenItem,
  onViewAll,
}: {
  items: HomeDiscoveryPayload["recently_played"];
  onOpenItem: (item: HomeRecentItem) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const visibleItems = isDesktop ? items : items.slice(0, 4);
  const pages = chunkItems(visibleItems, 9);
  const rail = useSectionRail(pages.length);
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.recentlyPlayed.title")}
        subtitle={t("home.sections.recentlyPlayed.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("recently-played")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} className="gap-0">
        {pages.map((pageItems, pageIndex) => (
          <div
            key={`recent-page-${pageIndex}`}
            className="min-w-full snap-start"
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((item) => (
                <RecentEntityRow
                  key={[
                    item.type,
                    openRecentItemPath(item),
                    item.played_at ?? "",
                  ].join(":")}
                  item={item}
                  onClick={() => onOpenItem(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionRail>
    </section>
  );
}

export function ListeningHistorySection({
  items,
  onOpenHistory,
}: {
  items: HomeListeningHistoryCard[];
  onOpenHistory: (item?: HomeListeningHistoryCard) => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const featured = items.slice(0, 4);

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.listeningDna.title")}
        subtitle={t("home.sections.listeningDna.subtitle")}
        actionLabel={t("home.sections.listeningDna.action")}
        onAction={() => onOpenHistory()}
      />
      <div className="flex flex-wrap gap-5">
        {featured.map((item, index) => (
          <ListeningHistoryCard
            key={item.id}
            item={item}
            index={index}
            onOpen={onOpenHistory}
          />
        ))}
      </div>
    </section>
  );
}

function ListeningHistoryCard({
  item,
  index,
  onOpen,
}: {
  item: HomeListeningHistoryCard;
  index: number;
  onOpen: (item: HomeListeningHistoryCard) => void;
}) {
  const { t } = useTranslation();
  const artists =
    item.subtitle || t("home.sections.listeningDna.defaultSubtitle");

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group w-[min(42vw,13rem)] shrink-0 touch-manipulation text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas lg:w-56"
    >
      <EditorialPlaylistArtwork
        title={historyLabel(item)}
        kicker={historyKicker(item)}
        tracks={item.artwork_tracks}
        variant="history"
        className={cn(
          "home-history-card aspect-[1.12] rounded-xl",
          HISTORY_TONES[index % HISTORY_TONES.length],
        )}
        textClassName={cn(
          item.kind === "all_time"
            ? "[&_div:first-child]:text-[clamp(1.2rem,13cqw,2.45rem)]"
            : "[&_div:first-child]:text-[clamp(2rem,20cqw,3.35rem)]",
        )}
      />
      <div className="mt-2.5 flex min-h-[5.4rem] flex-col">
        <div className="truncate text-sm font-black tracking-[-0.035em] text-text-primary">
          {historyDisplayTitle(item)}
        </div>
        <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-text-muted">
          {artists}
        </p>
        <div className="home-history-meta mt-auto text-[10px] font-bold uppercase tracking-[0.14em]">
          {t("common.playCount", { count: item.play_count })} ·{" "}
          {formatHistoryMinutes(item.minutes_listened)}
        </div>
      </div>
    </button>
  );
}

function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function openRecentItemPath(item: HomeRecentItem): string {
  if (item.type === "playlist") {
    return item.playlist_scope === "system"
      ? `/curation/playlist/${item.playlist_id}`
      : `/playlist/${item.playlist_id}`;
  }
  if (item.type === "artist") {
    return artistPagePath({
      artistId: item.artist_id,
      artistEntityUid: item.artist_entity_uid,
      globalArtistUid: item.global_artist_uid,
      artistSlug: item.artist_slug,
      artistName: item.artist_name,
    });
  }
  return albumPagePath({
    albumId: item.album_id,
    albumEntityUid: item.album_entity_uid,
    globalAlbumUid: item.global_album_uid,
    artistEntityUid: item.artist_entity_uid,
    albumSlug: item.album_slug,
    artistName: item.artist_name,
    albumName: item.album_name,
  });
}
