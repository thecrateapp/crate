import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Radio, Route } from "@crate/ui/icons";
import { toast } from "sonner";

import {
  DecadeDetailView,
  ExploreLoadingState,
  ExplorePill,
  ExploreSectionHeader,
  ExploreSectionRail,
  GenreDetailView,
  PlaylistCategoryView,
} from "@/components/explore/ExploreViews";
import {
  loadSystemPlaylistTracks,
  type BrowseFilters,
  type SystemPlaylist,
} from "@/components/explore/explore-model";
import { useApi } from "@/hooks/use-api";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { CrateImage } from "@/components/artwork/CrateImage";
import { usePlayerActions } from "@/contexts/PlayerContext";

export function Explore() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");
  const playlistCategory = searchParams.get("playlistCategory");

  const {
    data: explorePage,
    loading,
    refetch,
  } = useApi<ExplorePageData>("/api/browse/explore-page");
  const filters = explorePage?.filters;
  const featuredPlaylists = explorePage?.playlists || [];
  const moods = explorePage?.moods || [];

  async function handlePlayPlaylist(playlistId: number, playlistName: string) {
    try {
      const playlist = await loadSystemPlaylistTracks(playlistId);
      if (playlist.tracks.length > 0) {
        playAll(playlist.tracks, 0, { ...playlist.source, name: playlistName });
      }
    } catch {
      toast.error(t("explore.toasts.playPlaylistFailed"));
    }
  }

  async function handleToggleFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(
        `/api/curation/playlists/${playlistId}/follow`,
        isFollowed ? "DELETE" : "POST",
      );
      toast.success(
        isFollowed
          ? t("explore.toasts.removedFromLibrary")
          : t("explore.toasts.addedToLibrary"),
      );
      refetch();
    } catch {
      toast.error(t("explore.toasts.updatePlaylistFailed"));
    }
  }

  // Genre or decade detail view
  const decadeParam = searchParams.get("decade");
  if (genreSlug) {
    return (
      <GenreDetailView slug={genreSlug} onBack={() => setSearchParams({})} />
    );
  }
  if (decadeParam) {
    return (
      <DecadeDetailView
        decade={decadeParam}
        onBack={() => setSearchParams({})}
      />
    );
  }
  if (playlistCategory) {
    return (
      <PlaylistCategoryView
        category={playlistCategory}
        onBack={() => setSearchParams({})}
      />
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("explore.title")}</h1>
      <div className="space-y-6">
        {loading ? <ExploreLoadingState /> : null}

        {filters ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ExploreFeatureCard
                title={t("explore.features.radio.title")}
                subtitle={t("explore.features.radio.subtitle")}
                icon={Radio}
                onClick={() => navigate("/radio")}
              />
              <ExploreFeatureCard
                title={t("explore.features.paths.title")}
                subtitle={t("explore.features.paths.subtitle")}
                icon={Route}
                onClick={() => navigate("/paths")}
              />
            </div>

            <GenreExplorer
              genres={filters.genres}
              onOpen={(genre) =>
                setSearchParams({
                  genre: genre.toLowerCase().replace(/\s+/g, "-"),
                })
              }
            />

            {/* Decades */}
            {filters.decades.length > 0 && (
              <div className="space-y-4">
                <ExploreSectionHeader
                  title={t("explore.timeTunnels.title")}
                  subtitle={t("explore.timeTunnels.subtitle")}
                />
                <div className="flex flex-wrap gap-2">
                  {filters.decades.map((d) => (
                    <ExplorePill
                      key={d}
                      label={d}
                      count={0}
                      onClick={() => setSearchParams({ decade: d })}
                    />
                  ))}
                </div>
              </div>
            )}
            {/* Moods — browse by audio analysis */}
            <MoodBrowseSection moods={moods} />

            {featuredPlaylists.length > 0 ? (
              <ExploreCratePlaylists
                playlists={featuredPlaylists}
                onOpen={(playlistId) =>
                  navigate(`/curation/playlist/${playlistId}`)
                }
                onPlay={handlePlayPlaylist}
                onToggleFollow={handleToggleFollow}
              />
            ) : null}
          </>
        ) : (
          <p className="text-text-muted text-sm">{t("explore.noFilters")}</p>
        )}
      </div>
    </div>
  );
}

const MOOD_COLORS: Record<string, string> = {
  energetic: "bg-state-warning/20 text-state-warning border-state-warning/30",
  chill: "bg-state-info/20 text-state-info border-state-info/30",
  dark: "bg-state-danger/20 text-state-danger border-state-danger/30",
  happy: "bg-state-warning/20 text-state-warning border-state-warning/30",
  melancholy: "bg-state-info/20 text-state-info border-state-info/30",
  intense: "bg-state-danger/20 text-state-danger border-state-danger/30",
  groovy: "bg-state-success/20 text-state-success border-state-success/30",
  acoustic: "bg-state-warning/20 text-state-warning border-state-warning/30",
};

interface MoodPreset {
  name: string;
  track_count: number;
}

interface ExplorePageData {
  filters: BrowseFilters;
  playlists: SystemPlaylist[];
  moods: MoodPreset[];
}

function ExploreFeatureCard({
  title,
  subtitle,
  icon: Icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: typeof Radio;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="explore-feature-card group relative min-h-36 overflow-hidden rounded-[12px] p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/60"
    >
      <div className="explore-feature-card-aura absolute inset-0 opacity-80 transition group-hover:opacity-100" />
      <div className="relative flex h-full flex-col justify-between gap-8">
        <div className="flex items-center justify-between">
          <Icon
            size={24}
            className="text-accent-action drop-shadow-accent-action-feature"
          />
          <ArrowRight
            size={18}
            className="text-text-primary/35 transition group-hover:translate-x-1 group-hover:text-accent-action"
          />
        </div>
        <div>
          <div className="text-xl font-black tracking-[-0.035em] text-text-primary">
            {title}
          </div>
          <div className="mt-2 max-w-[28rem] text-sm leading-5 text-text-primary/58">
            {subtitle}
          </div>
        </div>
      </div>
    </button>
  );
}

function ExploreCratePlaylists({
  playlists,
  onOpen,
  onPlay,
  onToggleFollow,
}: {
  playlists: SystemPlaylist[];
  onOpen: (playlistId: number) => void;
  onPlay: (playlistId: number, playlistName: string) => void;
  onToggleFollow: (playlistId: number, isFollowed: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <ExploreSectionHeader
        title={t("explore.fromCrate.title")}
        subtitle={t("explore.fromCrate.subtitle")}
      />
      <ExploreSectionRail>
        {playlists.map((playlist) => (
          <PlaylistCard
            key={playlist.id}
            playlistId={playlist.id}
            name={playlist.name}
            isSmart={playlist.is_smart}
            description={playlist.description}
            tracks={playlist.artwork_tracks}
            coverDataUrl={playlist.cover_data_url}
            meta={[
              playlist.category || null,
              t("common.trackCount", { count: playlist.track_count }),
              playlist.follower_count > 0
                ? t("common.followerCount", {
                    count: playlist.follower_count,
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            systemPlaylist
            crateManaged
            isFollowed={playlist.is_followed}
            href={`/curation/playlist/${playlist.id}`}
            onPlay={() => onPlay(playlist.id, playlist.name)}
            onToggleFollow={() =>
              onToggleFollow(playlist.id, playlist.is_followed)
            }
            onClick={() => onOpen(playlist.id)}
          />
        ))}
      </ExploreSectionRail>
    </section>
  );
}

function GenreExplorer({
  genres,
  onOpen,
}: {
  genres: BrowseFilters["genres"];
  onOpen: (genre: string) => void;
}) {
  const { t } = useTranslation();
  const topGenres = [...genres].sort((a, b) => b.count - a.count).slice(0, 12);
  if (!topGenres.length) return null;

  function getGenreSlug(genre: (typeof topGenres)[number]) {
    return genre.slug?.trim() || genre.name.toLowerCase().replace(/\s+/g, "-");
  }

  return (
    <section className="space-y-4">
      <ExploreSectionHeader
        title={t("explore.genreRooms.title")}
        subtitle={t("explore.genreRooms.subtitle")}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {topGenres.slice(0, 8).map((genre, index) => {
          const resolvedCoverUrl = resolveMaybeApiAssetUrl(genre.cover_url);
          const detail =
            genre.description ||
            (genre.top_artists?.length
              ? genre.top_artists.slice(0, 3).join(", ")
              : null);

          return (
            <button
              key={genre.slug || genre.name}
              type="button"
              onClick={() => onOpen(getGenreSlug(genre))}
              className="explore-genre-card group relative min-h-36 overflow-hidden rounded-[12px] p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/60"
            >
              {resolvedCoverUrl ? (
                <CrateImage
                  src={resolvedCoverUrl}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover opacity-60 blur-[1px] saturate-125 transition duration-300 group-hover:scale-[1.04] group-hover:opacity-70"
                />
              ) : null}
              <div
                className={`explore-genre-card-overlay absolute inset-0 opacity-80 ${
                  resolvedCoverUrl
                    ? "explore-genre-card-overlay-image"
                    : `explore-genre-card-overlay-placeholder explore-genre-card-overlay-position-${
                        index % 4
                      }`
                }`}
              />
              <div className="relative flex h-full flex-col justify-between gap-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent-action/90">
                    {t("explore.genreRooms.badge")}
                  </span>
                  <Radio
                    size={15}
                    className="text-text-primary/30 transition group-hover:text-accent-action"
                  />
                </div>
                <div>
                  <div className="text-lg font-black leading-none tracking-[-0.04em] text-text-primary">
                    {genre.name}
                  </div>
                  {detail ? (
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-text-primary/62">
                      {detail}
                    </div>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MoodBrowseSection({ moods }: { moods: MoodPreset[] }) {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const [loadingMood, setLoadingMood] = useState<string | null>(null);

  async function playMood(mood: string) {
    // Resume AudioContext synchronously in the user gesture before the await
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch {
      /* ok */
    }
    setLoadingMood(mood);
    try {
      const data = await api<{
        tracks: Array<{
          id: number;
          entity_uid?: string;
          title: string;
          artist: string;
          artist_id?: number;
          artist_entity_uid?: string;
          artist_slug?: string;
          album: string;
          album_id?: number;
          album_entity_uid?: string;
          album_slug?: string;
          path: string;
        }>;
      }>(`/api/browse/mood/${mood}?limit=50`);
      if (data.tracks.length > 0) {
        playAll(
          data.tracks.map((t) =>
            toPlayableTrack(t, {
              cover: albumCoverApiUrl(
                {
                  albumId: t.album_id,
                  albumEntityUid: t.album_entity_uid,
                  artistEntityUid: t.artist_entity_uid,
                  albumSlug: t.album_slug,
                  artistName: t.artist,
                  albumName: t.album,
                },
                { size: 512 },
              ),
            }),
          ),
          0,
          {
            type: "playlist",
            name: t("explore.moods.mixName", {
              mood: mood.charAt(0).toUpperCase() + mood.slice(1),
            }),
          },
        );
      } else {
        toast.info(t("explore.toasts.noMoodTracks"));
      }
    } catch {
      toast.error(t("explore.toasts.loadMoodTracksFailed"));
    } finally {
      setLoadingMood(null);
    }
  }

  if (moods.length === 0) return null;

  return (
    <div className="space-y-3">
      <ExploreSectionHeader
        title={t("explore.moods.title")}
        subtitle={t("explore.moods.subtitle")}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {moods.map((m) => (
          <button
            key={m.name}
            onClick={() => playMood(m.name)}
            disabled={loadingMood !== null}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              MOOD_COLORS[m.name] ||
              "bg-text-primary/5 text-text-primary/70 border-border-quiet"
            } active:scale-[0.98]`}
          >
            <span className="text-sm font-medium capitalize">
              {loadingMood === m.name ? t("common.loadingShort") : m.name}
            </span>
            <span className="block text-[10px] opacity-60 mt-0.5">
              {t("common.trackCount", { count: m.track_count })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
