import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Play, Search } from "@crate/ui/icons";

import { useApi } from "@/hooks/use-api";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";
import { WindowVirtualList } from "@/components/ui/WindowVirtualList";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";

import { EmptyState, Spinner } from "./LibraryPrimitives";

type ArtistSort = "recent" | "name" | "popularity";
type AlbumSort = "recent" | "name" | "artist" | "year";
type LikedSort = "recent" | "title" | "artist" | "album";

interface FollowedArtist {
  artist_name: string;
  artist_id?: number;
  global_artist_uid?: string;
  artist_entity_uid?: string;
  artist_slug?: string;
  created_at: string;
  album_count: number;
  track_count: number;
  has_photo: boolean;
  photo_url?: string | null;
}

interface SavedAlbum {
  saved_at: string;
  id?: number | null;
  global_album_uid?: string;
  album_entity_uid?: string;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  name: string;
  year: string;
  has_cover: boolean;
  cover_url?: string | null;
  track_count: number;
  total_duration: number;
}

const artistSortOptions: { value: ArtistSort; labelKey: string }[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "name", labelKey: "common.name" },
  { value: "popularity", labelKey: "library.sort.popularity" },
];

const albumSortOptions: { value: AlbumSort; labelKey: string }[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "name", labelKey: "common.name" },
  { value: "artist", labelKey: "common.artist" },
  { value: "year", labelKey: "library.sort.year" },
];

const likedSortOptions: { value: LikedSort; labelKey: string }[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "title", labelKey: "library.sort.title" },
  { value: "artist", labelKey: "common.artist" },
  { value: "album", labelKey: "common.album" },
];

function CollectionSortDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; labelKey: string }[];
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useDismissibleLayer({
    active: open,
    refs: [rootRef],
    onDismiss: () => setOpen(false),
  });

  if (!selected) return null;
  const selectedLabel = t(selected.labelKey);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t("library.sort.selectedAria", {
          label,
          value: selectedLabel,
        })}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={[
          "listen-glass-panel flex h-10 min-w-[172px] items-center justify-between gap-3 rounded-lg border border-border-quiet/10 px-4 text-sm font-semibold text-text-primary transition-[border-color,box-shadow,filter,transform] hover:-translate-y-px hover:border-accent-action/40 hover:shadow-accent-action-soft focus-visible:border-accent-action/70 focus-visible:outline-none focus-visible:shadow-accent-action",
          open ? "border-accent-action/45 shadow-accent-action" : "",
        ].join(" ")}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={16}
          className={[
            "shrink-0 text-text-primary/55 transition-transform",
            open ? "rotate-180 text-accent-action" : "",
          ].join(" ")}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="listen-glass-panel absolute right-0 top-full z-app-dropdown mt-2 w-48 overflow-hidden rounded-[12px] border border-border-quiet/10 p-1 shadow-menu animate-pop-in"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={[
                  "flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-[background-color,color,filter]",
                  selected
                    ? "bg-accent-action/14 text-accent-action drop-shadow-accent-action"
                    : "text-text-primary hover:bg-text-primary/7 hover:text-accent-action hover:drop-shadow-accent-action-soft",
                ].join(" ")}
              >
                <span>{t(option.labelKey)}</span>
                {selected ? <Check size={16} className="shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function LibraryArtistsTab() {
  const { t } = useTranslation();
  const { data: artists, loading } = useApi<FollowedArtist[]>(
    "/api/catalog/me/artists",
  );
  const isDesktop = useIsDesktop();
  const [sort, setSort] = useState<ArtistSort>("recent");

  const sortedArtists = useMemo(() => {
    if (!artists) return [];
    return [...artists].sort((a, b) => {
      if (sort === "name") {
        return a.artist_name.localeCompare(b.artist_name);
      }
      if (sort === "popularity") {
        const aScore = a.album_count * 12 + a.track_count;
        const bScore = b.album_count * 12 + b.track_count;
        return bScore - aScore || a.artist_name.localeCompare(b.artist_name);
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [artists, sort]);

  if (loading) return <Spinner />;
  if (!artists || artists.length === 0) {
    return <EmptyState message={t("library.artists.empty")} />;
  }

  return (
    <div className="space-y-4">
      {!isDesktop ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-primary/40">
            {t("library.sort.label")}
          </span>
          <CollectionSortDropdown
            label={t("library.sort.artists")}
            value={sort}
            options={artistSortOptions}
            onChange={setSort}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {sortedArtists.map((artist) => (
          <ArtistCard
            key={
              artist.global_artist_uid ?? artist.artist_id ?? artist.artist_name
            }
            name={artist.artist_name}
            artistId={artist.artist_id}
            artistEntityUid={artist.artist_entity_uid}
            globalArtistUid={artist.global_artist_uid}
            artistSlug={artist.artist_slug}
            photo={artist.photo_url ?? undefined}
            hasPhoto={artist.has_photo}
            subtitle={t("common.albumCountLabel", {
              count: artist.album_count,
            })}
            layout="grid"
          />
        ))}
      </div>
    </div>
  );
}

export function LibraryAlbumsTab() {
  const { t } = useTranslation();
  const { data: albums, loading } = useApi<SavedAlbum[]>(
    "/api/catalog/me/albums",
  );
  const isDesktop = useIsDesktop();
  const [sort, setSort] = useState<AlbumSort>("recent");

  const sortedAlbums = useMemo(() => {
    if (!albums) return [];
    return [...albums].sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sort === "artist") {
        return a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);
      }
      if (sort === "year") {
        return (
          Number(b.year || 0) - Number(a.year || 0) ||
          a.name.localeCompare(b.name)
        );
      }
      return new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime();
    });
  }, [albums, sort]);

  if (loading) return <Spinner />;
  if (!albums || albums.length === 0) {
    return <EmptyState message={t("library.albums.empty")} />;
  }

  return (
    <div className="space-y-4">
      {!isDesktop ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-primary/40">
            {t("library.sort.label")}
          </span>
          <CollectionSortDropdown
            label={t("library.sort.albums")}
            value={sort}
            options={albumSortOptions}
            onChange={setSort}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {sortedAlbums.map((album) => (
          <AlbumCard
            key={album.global_album_uid ?? album.id}
            artist={album.artist}
            album={album.name}
            albumId={album.id ?? undefined}
            albumEntityUid={album.album_entity_uid}
            globalAlbumUid={album.global_album_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.slug}
            year={album.year}
            cover={album.cover_url ?? undefined}
            layout="grid"
          />
        ))}
      </div>
    </div>
  );
}

export function LibraryLikedTab() {
  const { t } = useTranslation();
  const { likedTracks: tracks, loading } = useLikedTracks();
  const { playAll } = usePlayerActions();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LikedSort>("recent");

  const filtered = useMemo(() => {
    if (!tracks) return [];
    let list = [...tracks];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (track) =>
          track.title?.toLowerCase().includes(q) ||
          track.artist?.toLowerCase().includes(q) ||
          track.album?.toLowerCase().includes(q),
      );
    }
    if (sort === "title")
      list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    else if (sort === "artist")
      list.sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
    else if (sort === "album")
      list.sort((a, b) => (a.album || "").localeCompare(b.album || ""));
    return list;
  }, [tracks, search, sort]);

  const trackRows = useMemo<TrackRowData[]>(
    () =>
      filtered.map((track) =>
        toTrackRowData({
          ...track,
          id:
            track.track_id ?? track.relative_path ?? track.path ?? track.title,
          path: track.relative_path || track.path,
          library_track_id: track.track_id,
        }),
      ),
    [filtered],
  );

  if (loading) return <Spinner />;
  if (!tracks || tracks.length === 0) {
    return <EmptyState message={t("library.liked.empty")} />;
  }

  function handlePlayAll() {
    const list = filtered.length ? filtered : tracks;
    const playerTracks: Track[] = list.map((track) =>
      toPlayableTrack(
        {
          ...track,
          id:
            track.track_id ?? track.relative_path ?? track.path ?? track.title,
          path: track.relative_path || track.path,
          library_track_id: track.track_id,
        },
        {
          cover:
            track.artist && track.album
              ? albumCoverApiUrl(
                  {
                    albumId: track.album_id,
                    albumEntityUid: track.album_entity_uid,
                    artistEntityUid: track.artist_entity_uid,
                    albumSlug: track.album_slug,
                    artistName: track.artist,
                    albumName: track.album,
                  },
                  { size: 512 },
                )
              : undefined,
        },
      ),
    );
    playAll(playerTracks, 0);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePlayAll}
          className="flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
        >
          <Play size={16} fill="currentColor" />
          {filtered.length < tracks.length
            ? t("library.liked.playFiltered", { count: filtered.length })
            : t("library.liked.playAll")}
        </button>
        <div className="relative min-w-[180px] flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-primary/40"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("library.liked.filterPlaceholder")}
            className="h-10 w-full rounded-lg bg-text-primary/5 pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-primary/40 focus:bg-text-primary/8"
          />
        </div>
        <CollectionSortDropdown
          label={t("library.sort.likedTracks")}
          value={sort}
          options={likedSortOptions}
          onChange={setSort}
        />
      </div>
      <WindowVirtualList
        items={trackRows}
        estimateSize={72}
        itemKey={(row, index) =>
          row.id ??
          row.path ??
          row.artist + "-" + row.album + "-" + row.title + "-" + index
        }
        renderItem={(row, index) => (
          <TrackRow
            track={row}
            index={index + 1}
            showArtist
            showAlbum
            albumCover={
              row.artist && row.album
                ? albumCoverApiUrl(
                    {
                      albumId: row.album_id,
                      albumEntityUid: row.album_entity_uid,
                      artistEntityUid: row.artist_entity_uid,
                      albumSlug: row.album_slug,
                      artistName: row.artist,
                      albumName: row.album,
                    },
                    { size: 128 },
                  )
                : undefined
            }
            showCoverThumb
            queueTracks={trackRows}
          />
        )}
      />
    </div>
  );
}
