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

import type {
  HomeDiscoveryPayload,
  HomeRecentItem,
  HomeSectionId,
} from "./home-model";

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
