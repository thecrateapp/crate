import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Disc3, Play, Search } from "@crate/ui/icons";
import { api, ApiError } from "@/lib/api";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
} from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow } from "@/components/cards/TrackRow";
import { CrateImage } from "@/components/artwork/CrateImage";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";

interface SearchData {
  artists: {
    id?: number;
    entity_uid?: string;
    global_uid?: string;
    global_artist_uid?: string;
    slug?: string;
    name: string;
    origin?: "local" | "remote";
    node_uid?: string;
    node_name?: string;
    remote_entity_uid?: string;
    has_photo?: boolean;
  }[];
  albums: {
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    name: string;
    id?: number;
    entity_uid?: string;
    global_uid?: string;
    global_album_uid?: string;
    slug?: string;
    year?: string;
    has_cover?: boolean;
    origin?: "local" | "remote";
    node_uid?: string;
    node_name?: string;
    remote_entity_uid?: string;
  }[];
  tracks: {
    id?: number;
    entity_uid?: string;
    global_uid?: string;
    global_track_uid?: string;
    globalTrackUid?: string;
    slug?: string;
    title: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    album: string;
    album_id?: number;
    album_entity_uid?: string;
    global_album_uid?: string;
    album_slug?: string;
    path?: string;
    duration?: number;
    bpm?: number | null;
    audio_key?: string | null;
    audio_scale?: string | null;
    energy?: number | null;
    danceability?: number | null;
    valence?: number | null;
    bliss_vector?: number[] | null;
    origin?: "local" | "remote";
    node_uid?: string;
    node_name?: string;
    remote_entity_uid?: string;
    availability?: {
      catalog: boolean;
      stream: boolean;
      import: boolean;
      stale?: boolean;
      local?: boolean;
      remote?: boolean;
      healthy?: boolean;
    };
  }[];
}

function artistGlobalUid(input: SearchData["artists"][0]): string | null {
  return input.global_artist_uid ?? input.global_uid ?? null;
}

function albumGlobalUid(input: SearchData["albums"][0]): string | null {
  return input.global_album_uid ?? input.global_uid ?? null;
}

function trackGlobalUid(input: SearchData["tracks"][0]): string | null {
  return (
    input.globalTrackUid ?? input.global_track_uid ?? input.global_uid ?? null
  );
}

function trackGlobalAlbumUid(input: SearchData["tracks"][0]): string | null {
  return input.global_album_uid ?? input.album_entity_uid ?? null;
}

function trackAlbumCover(track: SearchData["tracks"][0]) {
  const globalAlbumUid = trackGlobalAlbumUid(track);
  if (trackGlobalUid(track) && globalAlbumUid) {
    return albumCoverApiUrl({ globalAlbumUid }, { size: 128 });
  }
  return albumCoverApiUrl(
    {
      albumId: track.album_id,
      albumEntityUid: track.album_entity_uid,
      artistEntityUid: track.artist_entity_uid,
      albumSlug: track.album_slug,
      artistName: track.artist,
      albumName: track.album,
    },
    { size: 128 },
  );
}

function searchErrorHint(
  error: unknown,
  messages: { sessionRefresh: string; tryAgain: string },
): string {
  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403)
  ) {
    return messages.sessionRefresh;
  }
  return messages.tryAgain;
}

export function SearchResults() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [emptyQuery, setEmptyQuery] = useState("");
  const [data, setData] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { playAll } = usePlayerActions();

  useEffect(() => {
    if (!query.trim()) {
      setData(null);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setSearchError(null);
    api<SearchData>(
      `/api/catalog/search?q=${encodeURIComponent(query)}&limit=50`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((nextData) => {
        setData(nextData);
        setSearchError(null);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setData(null);
        setSearchError(
          searchErrorHint(e, {
            sessionRefresh: t("search.sessionRefresh"),
            tryAgain: t("search.tryAgain"),
          }),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, t]);

  const trackRowData = useMemo(
    () =>
      (data?.tracks ?? []).map((t, i) =>
        toTrackRowData({
          ...t,
          globalTrackUid: trackGlobalUid(t) ?? undefined,
          id: t.id ?? t.path ?? `${t.artist}-${t.title}-${i}`,
          library_track_id:
            !trackGlobalUid(t) && typeof t.id === "number" ? t.id : undefined,
        }),
      ),
    [data?.tracks],
  );

  if (!query)
    return (
      <div className="mx-auto max-w-2xl rounded-[12px] border border-border-quiet bg-text-primary/[0.035] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent-action/15 bg-accent-action/8 text-text-accent">
            <Search size={18} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {t("search.label")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("search.emptyPrompt")}
            </p>
          </div>
        </div>
        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const nextQuery = emptyQuery.trim();
            if (nextQuery) setSearchParams({ q: nextQuery });
          }}
        >
          <input
            autoFocus
            value={emptyQuery}
            onChange={(event) => setEmptyQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="h-11 min-w-0 flex-1 rounded-md border border-text-primary/12 bg-surface-canvas/20 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary/50"
          />
          <button
            type="submit"
            disabled={!emptyQuery.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-action transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            <Search size={17} />
            {t("search.label")}
          </button>
        </form>
      </div>
    );
  if (loading && !data)
    return <CrateLoader label={t("search.loadingResults")} />;
  if (searchError)
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold">
          {t("search.resultsFor", { query })}
        </h1>
        <div className="mx-auto max-w-sm rounded-[12px] border border-state-warning/12 bg-text-primary/[0.035] px-6 py-10 text-center shadow-[0_22px_70px_rgba(0,0,0,0.24)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-state-warning/15 bg-state-warning/8 text-state-warning-text">
            <Search size={18} />
          </div>
          <p className="mt-4 text-base font-semibold text-foreground">
            {t("search.unavailable")}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{searchError}</p>
        </div>
      </div>
    );
  if (!data) return null;
  const noResults =
    data.artists.length === 0 &&
    data.albums.length === 0 &&
    data.tracks.length === 0;

  const trackToPlayer = (t: SearchData["tracks"][0]): Track =>
    toPlayableTrack(
      {
        ...t,
        globalTrackUid: trackGlobalUid(t) ?? undefined,
        library_track_id:
          !trackGlobalUid(t) && typeof t.id === "number" ? t.id : undefined,
      },
      {
        cover: t.album ? trackAlbumCover(t) : undefined,
      },
    );

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">
        {t("search.resultsFor", { query })}
      </h1>

      {data.artists.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            {t("search.artistsCount", { count: data.artists.length })}
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {data.artists.map((a) => {
              const globalUid = artistGlobalUid(a);
              return globalUid ? (
                <ArtistCard
                  key={globalUid}
                  name={a.name}
                  globalArtistUid={globalUid}
                  hasPhoto={a.has_photo}
                  layout="grid"
                  href={artistPagePath({
                    artistId: a.id,
                    artistEntityUid: a.entity_uid,
                    globalArtistUid: globalUid,
                    artistSlug: a.slug,
                    artistName: a.name,
                  })}
                />
              ) : (
                <ArtistCard
                  key={a.id || a.entity_uid || a.name}
                  name={a.name}
                  artistId={a.id}
                  artistEntityUid={a.entity_uid}
                  artistSlug={a.slug}
                  layout="grid"
                />
              );
            })}
          </div>
        </section>
      )}

      {data.albums.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            {t("search.albumsCount", { count: data.albums.length })}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {data.albums.map((a) => {
              const globalUid = albumGlobalUid(a);
              return globalUid ? (
                <Link
                  key={globalUid}
                  to={albumPagePath({
                    albumId: a.id,
                    albumEntityUid: a.entity_uid,
                    globalAlbumUid: globalUid,
                    albumSlug: a.slug,
                    artistSlug: a.artist_slug,
                    artistName: a.artist,
                    albumName: a.name,
                  })}
                  className="group w-full min-w-0 snap-start cursor-pointer rounded-xl p-2 text-left transition-colors hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl"
                >
                  <div className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-text-primary/5">
                    {a.has_cover ? (
                      <CrateImage
                        src={
                          globalUid
                            ? albumCoverApiUrl(
                                { globalAlbumUid: globalUid },
                                { size: 320 },
                              )
                            : ""
                        }
                        alt={a.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Disc3 size={32} className="text-text-primary/25" />
                      </div>
                    )}
                  </div>
                  <p className="truncate text-sm font-medium text-foreground">
                    {a.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.year ? `${a.year} · ${a.artist}` : a.artist}
                  </p>
                </Link>
              ) : (
                <AlbumCard
                  layout="grid"
                  key={a.id || a.entity_uid || `${a.artist}-${a.name}`}
                  artist={a.artist}
                  album={a.name}
                  albumId={a.id}
                  albumEntityUid={a.entity_uid}
                  artistEntityUid={a.artist_entity_uid}
                  albumSlug={a.slug}
                  year={a.year}
                />
              );
            })}
          </div>
        </section>
      )}

      {trackRowData.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-semibold">
              {t("search.tracksCount", { count: data.tracks.length })}
            </h2>
            <button
              onClick={() =>
                playAll((data.tracks ?? []).map(trackToPlayer), 0, {
                  type: "queue",
                  name: t("search.playSource", { query }),
                })
              }
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <Play size={12} fill="currentColor" /> {t("search.playAll")}
            </button>
          </div>
          <div>
            {trackRowData.map((t, i) => (
              <TrackRow
                key={t.id || t.path || `${t.artist}-${t.title}-${i}`}
                track={t}
                index={i}
                showArtist
                showAlbum
                queueTracks={trackRowData}
                albumCover={trackAlbumCover(data.tracks[i]!)}
              />
            ))}
          </div>
        </section>
      )}

      {noResults ? (
        <div className="mx-auto max-w-sm rounded-[12px] border border-accent-action/12 bg-text-primary/[0.035] px-6 py-10 text-center shadow-[0_22px_70px_rgba(0,0,0,0.24)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-accent-action/15 bg-accent-action/8 text-text-accent">
            <Search size={18} />
          </div>
          <p className="mt-4 text-base font-semibold text-foreground">
            {t("search.noMusicFound")}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("search.noMusicHint")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
