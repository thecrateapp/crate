import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Disc3, Sparkles, UserRound } from "@crate/ui/icons";
import { EntityRow, type EntityMenuRenderer } from "@crate/ui/domain/entity";

import {
  ItemActionMenu,
  type ContextMenuHeader,
  type ItemActionMenuEntry,
  type UseItemActionMenuReturn,
} from "@/components/actions/ItemActionMenu";
import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";

import type { HomeRecentItem } from "./home-model";
import {
  openRecentItemPath,
  recentArtwork,
  recentPlaylistArtwork,
  recentSubtitle,
  recentTitle,
} from "./home-recent-entities-model";

type RecentMenuProps<T extends HomeRecentItem["type"]> = {
  item: Extract<HomeRecentItem, { type: T }>;
  controller: UseItemActionMenuReturn;
};

export function RecentEntityRow({
  item,
  onClick,
}: {
  item: HomeRecentItem;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const renderMenu = useCallback<EntityMenuRenderer>(
    (controller) => {
      if (item.type === "album") {
        return <RecentAlbumMenu item={item} controller={controller} />;
      }
      if (item.type === "artist") {
        return <RecentArtistMenu item={item} controller={controller} />;
      }
      return <RecentPlaylistMenu item={item} controller={controller} />;
    },
    [item],
  );
  const subtitle = recentSubtitle(item);

  return (
    <EntityRow
      title={recentTitle(item)}
      subtitle={subtitle || undefined}
      leading={<RecentEntityArtwork item={item} />}
      onOpen={onClick}
      renderMenu={renderMenu}
      menuLabel={t("actions.menu.more")}
      className="home-discovery-card gap-3 p-3"
      classNames={{
        action: "gap-3",
        title: "font-semibold",
        subtitle: "mt-1",
      }}
    />
  );
}

function RecentEntityArtwork({ item }: { item: HomeRecentItem }) {
  const artworkUrl = recentArtwork(item);
  return (
    <div className="home-discovery-artwork relative size-12 shrink-0 overflow-hidden rounded-xl">
      {item.type === "playlist" ? (
        <PlaylistArtwork
          name={item.playlist_name}
          coverDataUrl={item.playlist_cover_data_url}
          tracks={item.playlist_tracks}
          className=" size-full rounded-xl"
        />
      ) : artworkUrl ? (
        <CrateImage
          src={artworkUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className=" size-full object-cover"
        />
      ) : (
        <div className="home-discovery-artwork flex size-full items-center justify-center">
          {item.type === "artist" ? (
            <UserRound size={18} className="home-discovery-placeholder-icon" />
          ) : (
            <Disc3 size={18} className="home-discovery-placeholder-icon" />
          )}
        </div>
      )}
    </div>
  );
}

function RecentAlbumMenu({ item, controller }: RecentMenuProps<"album">) {
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
    <RecentEntityMenu
      controller={controller}
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
    />
  );
}

function RecentArtistMenu({ item, controller }: RecentMenuProps<"artist">) {
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
    <RecentEntityMenu
      controller={controller}
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
    />
  );
}

function RecentPlaylistMenu({ item, controller }: RecentMenuProps<"playlist">) {
  const actions = usePlaylistActionEntries({
    playlistId: item.playlist_id,
    name: item.playlist_name,
    isSmart: item.playlist_scope === "system",
    href: openRecentItemPath(item),
  });

  return (
    <RecentEntityMenu
      controller={controller}
      actions={actions}
      header={{
        type: "media",
        title: item.playlist_name,
        subtitle: item.playlist_description || item.subtitle,
        imageUrl: recentPlaylistArtwork(item),
        imageAlt: item.playlist_name,
        imageShape: "square",
        fallbackIcon: Sparkles,
      }}
    />
  );
}

function RecentEntityMenu({
  controller,
  actions,
  header,
}: {
  controller: UseItemActionMenuReturn;
  actions: ItemActionMenuEntry[];
  header: ContextMenuHeader;
}) {
  return (
    <ItemActionMenu
      actions={actions}
      header={header}
      open={controller.open}
      position={controller.position}
      menuRef={controller.menuRef}
      onClose={controller.close}
    />
  );
}
