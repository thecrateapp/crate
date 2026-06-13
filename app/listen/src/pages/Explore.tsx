import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
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
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { usePlayerActions } from "@/contexts/PlayerContext";

export function Explore() {
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
      toast.error("Failed to play playlist");
    }
  }

  async function handleToggleFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(
        `/api/curation/playlists/${playlistId}/follow`,
        isFollowed ? "DELETE" : "POST",
      );
      toast.success(
        isFollowed ? "Removed from your library" : "Added to your library",
      );
      refetch();
    } catch {
      toast.error("Failed to update playlist");
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
      <h1 className="text-2xl font-bold">Explore</h1>
      <div className="space-y-6">
        {loading ? <ExploreLoadingState /> : null}

        {filters ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ExploreFeatureCard
                title="Radio"
                subtitle="Start from a track, artist, album or genre."
                icon={Radio}
                onClick={() => navigate("/radio")}
              />
              <ExploreFeatureCard
                title="Music Paths"
                subtitle="Find the route between scenes, artists and records."
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
                  title="Time tunnels"
                  subtitle="Jump into eras with enough depth to wander."
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
          <p className="text-muted-foreground text-sm">No filters available.</p>
        )}
      </div>
    </div>
  );
}

const MOOD_COLORS: Record<string, string> = {
  energetic: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  chill: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  dark: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  happy: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  melancholy: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  intense: "bg-red-500/20 text-red-300 border-red-500/30",
  groovy: "bg-green-500/20 text-green-300 border-green-500/30",
  acoustic: "bg-amber-500/20 text-amber-300 border-amber-500/30",
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
      className="group relative min-h-36 overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))] p-5 text-left shadow-[0_18px_60px_rgba(0,0,0,0.24)] transition hover:border-primary/35 hover:bg-white/[0.07]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(6,182,212,0.28),transparent_38%),radial-gradient(circle_at_90%_80%,rgba(255,255,255,0.11),transparent_38%)] opacity-80 transition group-hover:opacity-100" />
      <div className="relative flex h-full flex-col justify-between gap-8">
        <div className="flex items-center justify-between">
          <Icon
            size={24}
            className="text-primary drop-shadow-[0_0_16px_rgba(6,182,212,0.35)]"
          />
          <ArrowRight
            size={18}
            className="text-white/35 transition group-hover:translate-x-1 group-hover:text-primary"
          />
        </div>
        <div>
          <div className="text-xl font-black tracking-[-0.035em] text-foreground">
            {title}
          </div>
          <div className="mt-2 max-w-[28rem] text-sm leading-5 text-white/58">
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
  return (
    <section className="space-y-4">
      <ExploreSectionHeader
        title="From Crate"
        subtitle="Global playlists curated and generated for discovery."
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
              `${playlist.track_count} tracks`,
              playlist.follower_count > 0
                ? `${playlist.follower_count} followers`
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
  const topGenres = [...genres].sort((a, b) => b.count - a.count).slice(0, 12);
  if (!topGenres.length) return null;

  return (
    <section className="space-y-4">
      <ExploreSectionHeader
        title="Genre rooms"
        subtitle="Start from a scene, then let Crate lead you sideways."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {topGenres.slice(0, 8).map((genre, index) => {
          const detail =
            genre.description ||
            (genre.top_artists?.length
              ? genre.top_artists.slice(0, 3).join(", ")
              : null);

          return (
            <button
              key={genre.name}
              type="button"
              onClick={() => onOpen(genre.name)}
              className="group relative min-h-36 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-primary/30 hover:bg-white/[0.06]"
            >
              {genre.cover_url ? (
                <img
                  src={genre.cover_url}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover opacity-60 blur-[1px] saturate-125 transition duration-300 group-hover:scale-[1.04] group-hover:opacity-70"
                />
              ) : null}
              <div
                className="absolute inset-0 opacity-80"
                style={{
                  background: genre.cover_url
                    ? "linear-gradient(180deg, rgba(3,6,10,0.16) 0%, rgba(3,6,10,0.82) 100%)"
                    : `radial-gradient(circle at ${
                        20 + (index % 4) * 18
                      }% 20%, rgba(34, 211, 238, 0.24), transparent 36%), radial-gradient(circle at 85% 85%, rgba(255,255,255,0.1), transparent 38%)`,
                }}
              />
              <div className="relative flex h-full flex-col justify-between gap-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/90">
                    Genre Room
                  </span>
                  <Radio
                    size={15}
                    className="text-white/30 transition group-hover:text-primary"
                  />
                </div>
                <div>
                  <div className="text-lg font-black leading-none tracking-[-0.04em] text-foreground">
                    {genre.name}
                  </div>
                  {detail ? (
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-white/62">
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
              cover: albumCoverApiUrl({
                albumId: t.album_id,
                albumEntityUid: t.album_entity_uid,
                artistEntityUid: t.artist_entity_uid,
                albumSlug: t.album_slug,
                artistName: t.artist,
                albumName: t.album,
              }),
            }),
          ),
          0,
          {
            type: "playlist",
            name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Mix`,
          },
        );
      } else {
        toast.info(
          "No tracks match this mood yet — analyze more of your library",
        );
      }
    } catch {
      toast.error("Failed to load mood tracks");
    } finally {
      setLoadingMood(null);
    }
  }

  if (moods.length === 0) return null;

  return (
    <div className="space-y-3">
      <ExploreSectionHeader
        title="Browse by Mood"
        subtitle="Powered by audio analysis of your library."
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {moods.map((m) => (
          <button
            key={m.name}
            onClick={() => playMood(m.name)}
            disabled={loadingMood !== null}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              MOOD_COLORS[m.name] || "bg-white/5 text-white/70 border-white/10"
            } active:scale-[0.98]`}
          >
            <span className="text-sm font-medium capitalize">
              {loadingMood === m.name ? "Loading..." : m.name}
            </span>
            <span className="block text-[10px] opacity-60 mt-0.5">
              {m.track_count} tracks
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
