import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Disc3, Radio, Route } from "lucide-react";
import { toast } from "sonner";

import { fetchArtistTopTracks } from "@/components/actions/shared";
import {
  CustomMixCard,
  HomeTasteHero,
  RecommendedTracksSection,
  SuggestedAlbumsSection,
} from "@/components/home/HomeDiscoverySections";
import { JustLandedSection } from "@/components/home/HomeLibrarySections";
import type {
  HomeDiscoveryPayload,
  HomeGeneratedPlaylistDetail,
  HomeGeneratedPlaylistSummary,
  HomeHeroArtist,
  HomeSectionId,
} from "@/components/home/home-model";
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
import { albumCoverApiUrl, artistPagePath } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { fetchHomePlaylistRadio } from "@/lib/radio";
import { toTrackRowData } from "@/lib/track-row-data";
import { shuffleArray } from "@/lib/utils";

export function Explore() {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const [searchParams, setSearchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");
  const playlistCategory = searchParams.get("playlistCategory");

  const { data: explorePage, loading, refetch } = useApi<ExplorePageData>("/api/browse/explore-page");
  const { data: homeDiscovery, refetch: refetchHomeDiscovery } = useApi<HomeDiscoveryPayload>(
    "/api/me/home/discovery",
    "GET",
    undefined,
    { reactive: false, revalidateIfCached: "idle", idleRevalidateMs: 30_000 },
  );
  const filters = explorePage?.filters;
  const featuredPlaylists = explorePage?.playlists || [];
  const moods = explorePage?.moods || [];
  const recommendedTracks = useMemo(
    () => (homeDiscovery?.recommended_tracks || []).map((track) => toTrackRowData(track)),
    [homeDiscovery?.recommended_tracks],
  );
  const heroes = useMemo(() => {
    const hero = homeDiscovery?.hero;
    return Array.isArray(hero) ? hero : hero ? [hero] : [];
  }, [homeDiscovery?.hero]);

  async function handlePlayHeroArtist(artist: HomeHeroArtist) {
    try {
      const queue = await fetchArtistTopTracks({
        artistId: artist.id,
        artistSlug: artist.slug,
        name: artist.name,
      });
      if (!queue.length) {
        toast.info("No top tracks available yet");
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: `${artist.name} Top Tracks`,
        radio: { seedType: "artist", seedId: artist.id },
      });
    } catch {
      toast.error("Failed to load artist tracks");
    }
  }

  async function handleToggleHeroFollow(artist: HomeHeroArtist) {
    try {
      await toggleArtistFollow(artist.id);
      refetchHomeDiscovery();
      toast.success(
        isFollowing(artist.id)
          ? `Unfollowed ${artist.name}`
          : `Following ${artist.name}`,
      );
    } catch {
      toast.error("Failed to update follow");
    }
  }

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

  async function loadHomePlaylist(playlistId: string) {
    return api<HomeGeneratedPlaylistDetail>(`/api/me/home/playlists/${encodeURIComponent(playlistId)}`);
  }

  async function handlePlayHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    try {
      const playlist = await loadHomePlaylist(item.id);
      const queue = (playlist.tracks || []).map((track) => toPlayableTrack(track));
      if (!queue.length) {
        toast.info("This playlist is still warming up");
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: playlist.name || item.name,
        id: playlist.id,
      });
    } catch {
      toast.error("Failed to load playlist");
    }
  }

  async function handleShuffleHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    try {
      const playlist = await loadHomePlaylist(item.id);
      const queue = (playlist.tracks || []).map((track) => toPlayableTrack(track));
      if (!queue.length) {
        toast.info("This playlist is still warming up");
        return;
      }
      playAll(shuffleArray(queue), 0, {
        type: "playlist",
        name: playlist.name || item.name,
        id: playlist.id,
      });
    } catch {
      toast.error("Failed to load playlist");
    }
  }

  async function handleHomePlaylistRadio(item: HomeGeneratedPlaylistSummary) {
    try {
      const radio = await fetchHomePlaylistRadio({
        playlistId: item.id,
        playlistName: item.name,
      });
      if (!radio.tracks.length) {
        toast.info("Playlist radio is not available yet");
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error("Failed to start playlist radio");
    }
  }

  function openHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    navigate(`/home/playlist/${encodeURIComponent(item.id)}`);
  }

  function openHomeSection(sectionId: HomeSectionId) {
    navigate(`/home/section/${sectionId}`);
  }

  async function handleToggleFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(`/api/curation/playlists/${playlistId}/follow`, isFollowed ? "DELETE" : "POST");
      toast.success(isFollowed ? "Removed from your library" : "Added to your library");
      refetch();
    } catch {
      toast.error("Failed to update playlist");
    }
  }

  // Genre or decade detail view
  const decadeParam = searchParams.get("decade");
  if (genreSlug) {
    return <GenreDetailView slug={genreSlug} onBack={() => setSearchParams({})} />;
  }
  if (decadeParam) {
    return <DecadeDetailView decade={decadeParam} onBack={() => setSearchParams({})} />;
  }
  if (playlistCategory) {
    return <PlaylistCategoryView category={playlistCategory} onBack={() => setSearchParams({})} />;
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Explore</h1>
      <HomeTasteHero
        heroes={heroes}
        isFollowing={isFollowing}
        onOpenArtist={(artist) => {
          navigate(
            artistPagePath({
              artistId: artist.id,
              artistSlug: artist.slug,
              artistName: artist.name,
            }),
          );
        }}
        onPlay={(artist) => void handlePlayHeroArtist(artist)}
        onToggleFollow={(artist) => void handleToggleHeroFollow(artist)}
        onInfo={(artist) => {
          navigate(
            artistPagePath({
              artistId: artist.id,
              artistSlug: artist.slug,
              artistName: artist.name,
            }),
          );
        }}
      />
      <div className="space-y-6">
        {loading ? (
          <ExploreLoadingState />
        ) : null}

        {filters ? (
          <>
            {/* Radio + Paths */}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => navigate("/radio")}
                className="group flex items-center gap-4 rounded-xl border border-primary/15 bg-primary/5 p-4 text-left transition hover:border-primary/30 hover:bg-primary/10"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <Radio size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">Radio</div>
                  <div className="mt-0.5 text-[12px] text-white/50">
                    Infinite music shaped by your likes and dislikes
                  </div>
                </div>
                <ArrowRight size={16} className="flex-shrink-0 text-primary/40 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
              <button
                onClick={() => navigate("/paths")}
                className="group flex items-center gap-4 rounded-xl border border-primary/15 bg-primary/5 p-4 text-left transition hover:border-primary/30 hover:bg-primary/10"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <Route size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">Music Paths</div>
                  <div className="mt-0.5 text-[12px] text-white/50">
                    Trace a route between artists, genres, or tracks
                  </div>
                </div>
                <ArrowRight size={16} className="flex-shrink-0 text-primary/40 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
            </div>

            <ExploreCustomMixes
              mixes={homeDiscovery?.custom_mixes || []}
              onOpen={openHomePlaylist}
              onPlay={handlePlayHomePlaylist}
              onShuffle={handleShuffleHomePlaylist}
              onRadio={handleHomePlaylistRadio}
              onViewAll={() => openHomeSection("custom-mixes")}
            />

            <ExploreNewArrivals
              albums={homeDiscovery?.suggested_albums || []}
              onViewAll={openHomeSection}
            />

            <RecommendedTracksSection
              tracks={recommendedTracks}
              onViewAll={openHomeSection}
            />

            <GenreExplorer
              genres={filters.genres}
              onOpen={(genre) => setSearchParams({ genre: genre.toLowerCase().replace(/\s+/g, "-") })}
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
                onOpen={(playlistId) => navigate(`/curation/playlist/${playlistId}`)}
                onPlay={handlePlayPlaylist}
                onToggleFollow={handleToggleFollow}
              />
            ) : null}

            <JustLandedSection
              artists={homeDiscovery?.recent_global_artists || []}
              loading={!homeDiscovery}
              onOpenExplore={() => navigate("/library?tab=artists")}
            />
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

interface MoodPreset { name: string; track_count: number; }

interface ExplorePageData {
  filters: BrowseFilters;
  playlists: SystemPlaylist[];
  moods: MoodPreset[];
}

function ExploreCustomMixes({
  mixes,
  onOpen,
  onPlay,
  onShuffle,
  onRadio,
  onViewAll,
}: {
  mixes: HomeGeneratedPlaylistSummary[];
  onOpen: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlay: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffle: (mix: HomeGeneratedPlaylistSummary) => void;
  onRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  onViewAll: () => void;
}) {
  if (!mixes.length) return null;
  return (
    <section className="space-y-4">
      <ExploreSectionHeader
        title="Made for your library"
        subtitle="Daily discovery and genre mixes built from your own collection."
        actionLabel="View all"
        onAction={onViewAll}
      />
      <ExploreSectionRail>
        {mixes.slice(0, 8).map((mix) => (
          <CustomMixCard
            key={mix.id}
            item={mix}
            onOpenMix={onOpen}
            onPlayMix={onPlay}
            onShuffleMix={onShuffle}
            onStartRadio={onRadio}
          />
        ))}
      </ExploreSectionRail>
    </section>
  );
}

function ExploreNewArrivals({
  albums,
  onViewAll,
}: {
  albums: HomeDiscoveryPayload["suggested_albums"];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  if (!albums.length) return null;
  return (
    <SuggestedAlbumsSection
      albums={albums}
      onViewAll={onViewAll}
    />
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
              playlist.follower_count > 0 ? `${playlist.follower_count} followers` : null,
            ].filter(Boolean).join(" · ")}
            systemPlaylist
            crateManaged
            isFollowed={playlist.is_followed}
            href={`/curation/playlist/${playlist.id}`}
            onPlay={() => onPlay(playlist.id, playlist.name)}
            onToggleFollow={() => onToggleFollow(playlist.id, playlist.is_followed)}
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
        {topGenres.slice(0, 8).map((genre, index) => (
          <button
            key={genre.name}
            type="button"
            onClick={() => onOpen(genre.name)}
            className="group relative min-h-28 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-primary/25 hover:bg-white/[0.06]"
          >
            <div
              className="absolute inset-0 opacity-70"
              style={{
                background: `radial-gradient(circle at ${20 + (index % 4) * 18}% 20%, rgba(34, 211, 238, 0.22), transparent 34%), radial-gradient(circle at 85% 85%, rgba(255,255,255,0.08), transparent 36%)`,
              }}
            />
            <div className="relative flex h-full flex-col justify-between gap-5">
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                  Scene
                </span>
                <Disc3 size={16} className="text-white/30 transition group-hover:text-primary" />
              </div>
              <div>
                <div className="text-lg font-black leading-none tracking-[-0.04em] text-foreground">{genre.name}</div>
                <div className="mt-2 text-xs text-muted-foreground">{genre.count} artists indexed</div>
              </div>
            </div>
          </button>
        ))}
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
    } catch { /* ok */ }
    setLoadingMood(mood);
    try {
      const data = await api<{ tracks: Array<{
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
      }> }>(`/api/browse/mood/${mood}?limit=50`);
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
          { type: "playlist", name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Mix` },
        );
      } else {
        toast.info("No tracks match this mood yet — analyze more of your library");
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
      <ExploreSectionHeader title="Browse by Mood" subtitle="Powered by audio analysis of your library." />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {moods.map((m) => (
          <button
            key={m.name}
            onClick={() => playMood(m.name)}
            disabled={loadingMood !== null}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${MOOD_COLORS[m.name] || "bg-white/5 text-white/70 border-white/10"} active:scale-[0.98]`}
          >
            <span className="text-sm font-medium capitalize">{loadingMood === m.name ? "Loading..." : m.name}</span>
            <span className="block text-[10px] opacity-60 mt-0.5">{m.track_count} tracks</span>
          </button>
        ))}
      </div>
    </div>
  );
}
