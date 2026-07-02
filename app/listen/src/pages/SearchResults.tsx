import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Play, Search } from "@crate/ui/icons";
import { api, ApiError } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow } from "@/components/cards/TrackRow";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";

interface SearchData {
  artists: { id?: number; entity_uid?: string; slug?: string; name: string }[];
  albums: {
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    name: string;
    id?: number;
    entity_uid?: string;
    slug?: string;
    year?: string;
  }[];
  tracks: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    title: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    album: string;
    album_id?: number;
    album_entity_uid?: string;
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
  }[];
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
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
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
      `/api/search?q=${encodeURIComponent(query)}&limit=50`,
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
          id: t.id ?? t.path ?? `${t.artist}-${t.title}-${i}`,
          library_track_id: typeof t.id === "number" ? t.id : undefined,
        }),
      ),
    [data?.tracks],
  );

  if (!query)
    return <p className="text-muted-foreground">{t("search.emptyPrompt")}</p>;
  if (loading && !data)
    return <CrateLoader label={t("search.loadingResults")} />;
  if (searchError)
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold">
          {t("search.resultsFor", { query })}
        </h1>
        <div className="mx-auto max-w-sm rounded-3xl border border-amber-200/12 bg-white/[0.035] px-6 py-10 text-center shadow-[0_22px_70px_rgba(0,0,0,0.24)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-300/15 bg-amber-300/8 text-amber-100">
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
        library_track_id: typeof t.id === "number" ? t.id : undefined,
      },
      {
        cover: t.album
          ? albumCoverApiUrl({
              albumId: t.album_id,
              albumEntityUid: t.album_entity_uid,
              artistEntityUid: t.artist_entity_uid,
              albumSlug: t.album_slug,
              artistName: t.artist,
              albumName: t.album,
            })
          : undefined,
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
            {data.artists.map((a) => (
              <ArtistCard
                key={a.id || a.entity_uid || a.name}
                name={a.name}
                artistId={a.id}
                artistEntityUid={a.entity_uid}
                artistSlug={a.slug}
                layout="grid"
              />
            ))}
          </div>
        </section>
      )}

      {data.albums.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            {t("search.albumsCount", { count: data.albums.length })}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {data.albums.map((a) => (
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
                cover={albumCoverApiUrl({
                  albumId: a.id,
                  albumEntityUid: a.entity_uid,
                  artistEntityUid: a.artist_entity_uid,
                  albumSlug: a.slug,
                  artistName: a.artist,
                  albumName: a.name,
                })}
              />
            ))}
          </div>
        </section>
      )}

      {data.tracks.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-semibold">
              {t("search.tracksCount", { count: data.tracks.length })}
            </h2>
            <button
              onClick={() =>
                playAll(data.tracks.map(trackToPlayer), 0, {
                  type: "queue",
                  name: t("search.playSource", { query }),
                })
              }
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white"
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
              />
            ))}
          </div>
        </section>
      )}

      {noResults ? (
        <div className="mx-auto max-w-sm rounded-3xl border border-cyan-200/12 bg-white/[0.035] px-6 py-10 text-center shadow-[0_22px_70px_rgba(0,0,0,0.24)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/8 text-cyan-200">
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
