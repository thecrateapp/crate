import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterBar } from "@crate/ui/domain/filters";
import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import {
  TrackList,
  type TrackListVirtualListProps,
} from "@crate/ui/domain/tracks";
import { CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { Button } from "@crate/ui/shadcn/button";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { WindowVirtualList } from "@/components/ui/WindowVirtualList";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";

import { CollectionSortDropdown } from "./LibraryCollectionSortDropdown";
import { likedSortOptions, type LikedSort } from "./library-collection-model";

const LIKED_FILTER_INPUT_CLASS_NAME =
  "h-10 rounded-lg border-transparent bg-text-primary/5 pl-9 shadow-none backdrop-blur-none md:text-base focus-visible:bg-text-primary/8";

function LikedTracksVirtualList({
  itemKey,
  ...props
}: TrackListVirtualListProps<TrackRowData>) {
  return (
    <WindowVirtualList
      {...props}
      itemKey={
        itemKey ? (item, index) => String(itemKey(item, index)) : undefined
      }
    />
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

  if (loading) return <LoadingState label={t("common.loadingShort")} />;
  if (!tracks || tracks.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        title={t("library.liked.emptyTitle")}
        description={t("library.liked.empty")}
      />
    );
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
      <FilterBar
        leading={
          <Button
            onClick={handlePlayAll}
            className="rounded-lg px-4 has-[>svg]:px-4"
          >
            <Play size={CRATE_ICON_SIZE.sm} fill="currentColor" />
            {filtered.length < tracks.length
              ? t("library.liked.playFiltered", { count: filtered.length })
              : t("library.liked.playAll")}
          </Button>
        }
        search={
          <SearchInput
            value={search}
            onValueChange={setSearch}
            label={t("library.liked.filterPlaceholder")}
            clearLabel={t("search.clear")}
            placeholder={t("library.liked.filterPlaceholder")}
            className={LIKED_FILTER_INPUT_CLASS_NAME}
          />
        }
        sort={
          <CollectionSortDropdown
            label={t("library.sort.likedTracks")}
            value={sort}
            options={likedSortOptions}
            onChange={setSort}
          />
        }
      />
      <TrackList
        items={trackRows}
        virtualList={LikedTracksVirtualList}
        itemKey={(row, index) =>
          row.id ??
          row.path ??
          row.artist + "-" + row.album + "-" + row.title + "-" + index
        }
        renderRow={(row, index) => (
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
