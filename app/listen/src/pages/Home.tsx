import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { fetchArtistTopTracks } from "@/components/actions/shared";
import {
  EssentialsSection,
  FavoriteArtistsSection,
  HomeTasteHero,
  openRecentItemPath,
  RecentlyPlayedSection,
  RecommendedTracksSection,
  SuggestedAlbumsSection,
  UpcomingAlbumsSection,
} from "@/components/home/HomeDiscoverySections";
import { JustLandedSection } from "@/components/home/HomeLibrarySections";
import {
  getHomeDateString,
  getHomeGreeting,
} from "@/components/home/HomeSections";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { HomeReplaySection } from "@/components/home/HomePlaybackSections";
import {
  HomeShowPrepSection,
  HomeUpcomingSection,
} from "@/components/home/HomeUpcomingSections";
import type {
  HomeDiscoveryPayload,
  HomeGeneratedPlaylistDetail,
  HomeGeneratedPlaylistSummary,
  HomeHeroArtist,
  HomeRecommendedTrack,
  HomeSectionId,
  HomeUpcomingInsight,
  HomeUpcomingItem,
  ReplayMix,
} from "@/components/home/home-model";
import {
  homeUpcomingAlbumKey,
  selectHomeRadarItems,
} from "@/components/home/home-model";
import { PullIndicator } from "@crate/ui/primitives/PullIndicator";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { useMediaAccessVersion } from "@/hooks/use-media-access-version";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { AUTH_TOKEN_EVENT, api, apiSseUrl } from "@/lib/api";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { fetchHomePlaylistRadio } from "@/lib/radio";
import { albumCoverApiUrl, artistPagePath } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  getSseChannelState,
  markSseChannelClosed,
  markSseChannelError,
  markSseChannelEvent,
  markSseChannelOpen,
  onSseChannelState,
} from "@/lib/sse";
import { onCacheInvalidation } from "@/lib/cache";
import { toTrackRowData } from "@/lib/track-row-data";
import { shuffleArray } from "@/lib/utils";

function toPlayerTrack(item: HomeRecommendedTrack): Track {
  return toPlayableTrack(item, {
    cover:
      item.artist && item.album
        ? albumCoverApiUrl(
            {
              albumId: item.album_id,
              globalAlbumUid: item.global_album_uid,
              albumEntityUid: item.album_entity_uid,
              artistEntityUid: item.artist_entity_uid,
              albumSlug: item.album_slug,
              artistName: item.artist,
              albumName: item.album,
            },
            { size: 512 },
          ) || undefined
        : undefined,
  });
}

function homePlaylistPath(playlistId: string): string {
  return `/home/playlist/${encodeURIComponent(playlistId)}`;
}

function homeSectionPath(sectionId: HomeSectionId): string {
  return `/home/section/${sectionId}`;
}

function snapshotVersion(
  payload: HomeDiscoveryPayload | null | undefined,
): number {
  return Number(payload?.snapshot?.version || 0);
}

const HOME_DISCOVERY_SSE_CHANNEL = "home-discovery";
const HOME_DISCOVERY_DEGRADE_AFTER_MS = 75_000;
const HOME_DISCOVERY_DEGRADED_REFRESH_MS = 60_000;

export function Home() {
  const mediaAccessVersion = useMediaAccessVersion();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { play, playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const isDesktop = useIsDesktop();

  const {
    data: discovery,
    error: discoveryError,
    loading: discoveryLoading,
    refetch: refetchDiscovery,
  } = useApi<HomeDiscoveryPayload>("/api/me/home/discovery", "GET", undefined, {
    reactive: false,
    revalidateIfCached: "idle",
    idleRevalidateMs: 12_000,
  });
  const [liveDiscovery, setLiveDiscovery] =
    useState<HomeDiscoveryPayload | null>(null);
  const [authTokenRevision, setAuthTokenRevision] = useState(0);
  const refreshingLiveDiscoveryRef = useRef(false);
  const lastDegradedRefreshAtRef = useRef(0);

  const applyDiscoveryPayload = useCallback(
    (next: HomeDiscoveryPayload | null) => {
      if (!next) return;
      startTransition(() => {
        setLiveDiscovery((current) =>
          snapshotVersion(next) >= snapshotVersion(current) ? next : current,
        );
      });
    },
    [],
  );

  useEffect(() => {
    if (discovery) {
      applyDiscoveryPayload(discovery);
    }
  }, [applyDiscoveryPayload, discovery]);

  const refreshLiveDiscovery = useCallback(
    async (fresh = false) => {
      if (refreshingLiveDiscoveryRef.current) return;
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        !navigator.onLine
      )
        return;
      refreshingLiveDiscoveryRef.current = true;
      try {
        const payload = await api<HomeDiscoveryPayload>(
          fresh ? "/api/me/home/discovery?fresh=1" : "/api/me/home/discovery",
        );
        applyDiscoveryPayload(payload);
      } catch {
        // Keep the last good snapshot; the stream may still recover on its own.
      } finally {
        refreshingLiveDiscoveryRef.current = false;
      }
    },
    [applyDiscoveryPayload],
  );

  useEffect(() => {
    const onAuthTokenUpdated = () => {
      setAuthTokenRevision((value) => value + 1);
    };
    window.addEventListener(AUTH_TOKEN_EVENT, onAuthTokenUpdated);
    return () =>
      window.removeEventListener(AUTH_TOKEN_EVENT, onAuthTokenUpdated);
  }, []);

  useEffect(() => {
    const source = new EventSource(
      apiSseUrl("/api/me/home/discovery-stream?initial=0"),
    );
    source.onopen = () => {
      const { reconnected } = markSseChannelOpen(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      if (reconnected) {
        void refreshLiveDiscovery();
      }
    };
    source.onmessage = (event) => {
      markSseChannelEvent(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      try {
        const next = JSON.parse(event.data) as HomeDiscoveryPayload;
        applyDiscoveryPayload(next);
      } catch {
        // Ignore malformed snapshots and keep the last good payload.
      }
    };
    source.addEventListener("heartbeat", () => {
      markSseChannelEvent(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
    });
    source.onerror = () => {
      markSseChannelError(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
    };
    return () => {
      markSseChannelClosed(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      source.close();
    };
  }, [
    applyDiscoveryPayload,
    authTokenRevision,
    mediaAccessVersion,
    refreshLiveDiscovery,
  ]);

  useEffect(() => {
    return onSseChannelState(HOME_DISCOVERY_SSE_CHANNEL, (state) => {
      if (!state.degraded) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        !navigator.onLine
      )
        return;
      const now = Date.now();
      if (
        now - lastDegradedRefreshAtRef.current <
        HOME_DISCOVERY_DEGRADED_REFRESH_MS
      )
        return;
      lastDegradedRefreshAtRef.current = now;
      void refreshLiveDiscovery();
    });
  }, [refreshLiveDiscovery]);

  useEffect(() => {
    const maybeRecoverFromDegradedStream = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        !navigator.onLine
      )
        return;
      const state = getSseChannelState(HOME_DISCOVERY_SSE_CHANNEL);
      if (!state?.degraded) return;
      void refreshLiveDiscovery();
    };
    window.addEventListener("online", maybeRecoverFromDegradedStream);
    document.addEventListener(
      "visibilitychange",
      maybeRecoverFromDegradedStream,
    );
    return () => {
      window.removeEventListener("online", maybeRecoverFromDegradedStream);
      document.removeEventListener(
        "visibilitychange",
        maybeRecoverFromDegradedStream,
      );
    };
  }, [refreshLiveDiscovery]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const scheduleFreshRefresh = () => {
      if (refreshTimer != null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshLiveDiscovery(true);
      }, 250);
    };
    const unsubscribe = onCacheInvalidation((scope) => {
      if (
        scope === "home" ||
        scope === "library" ||
        scope === "global_catalog" ||
        scope === "upcoming" ||
        scope.startsWith("home:user:") ||
        scope.startsWith("artist:") ||
        scope.startsWith("album:") ||
        scope.startsWith("playlist:")
      ) {
        scheduleFreshRefresh();
      }
    });
    return () => {
      unsubscribe();
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [refreshLiveDiscovery]);

  const currentDiscovery = liveDiscovery ?? discovery;
  // Normalize: backend now returns array, old cache may still return single object
  const heroRaw = currentDiscovery?.hero ?? null;
  const heroes: HomeHeroArtist[] = Array.isArray(heroRaw)
    ? heroRaw
    : heroRaw
      ? [heroRaw]
      : [];
  const recentGlobalArtists = currentDiscovery?.recent_global_artists || [];
  const upcoming = currentDiscovery?.upcoming;
  const replay = currentDiscovery?.replay as ReplayMix | undefined;
  const replayMonth = replay?.window?.startsWith("month:")
    ? replay.window.slice(6)
    : undefined;
  const globalArtistsLoading = !currentDiscovery;

  const onRefresh = useCallback(async () => {
    await refreshLiveDiscovery(true);
    refetchDiscovery();
  }, [refetchDiscovery, refreshLiveDiscovery]);

  const {
    handlers: pullHandlers,
    pullDistance,
    refreshing,
  } = usePullToRefresh(onRefresh);

  const replayPreview = (replay?.items || []).slice(0, 4);
  const upcomingAlbumKeys = new Set(
    (currentDiscovery?.upcoming_albums || []).map((album) =>
      homeUpcomingAlbumKey(album.artist_name, album.album_name),
    ),
  );
  const upcomingPreview = selectHomeRadarItems(
    upcoming?.items || [],
    upcomingAlbumKeys,
  );
  const homeInsights = (upcoming?.insights || []).slice(0, 2);

  const recommendedTracks = useMemo(
    () =>
      (currentDiscovery?.recommended_tracks || []).map((item) =>
        toTrackRowData(item),
      ),
    [currentDiscovery?.recommended_tracks],
  );

  function openHomeSection(sectionId: HomeSectionId) {
    navigate(homeSectionPath(sectionId));
  }

  async function playHeroArtist(artist: HomeHeroArtist) {
    try {
      const queue = await fetchArtistTopTracks({
        artistId: artist.id,
        artistSlug: artist.slug,
        name: artist.name,
      });
      if (!queue.length) {
        toast.info(t("actions.artist.toasts.noTopTracks"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("actions.artist.topTracksSource", { name: artist.name }),
        radio: { seedType: "artist", seedId: artist.id },
      });
    } catch {
      toast.error(t("actions.artist.toasts.loadTopTracksFailed"));
    }
  }

  async function toggleHeroFollow(artist: HomeHeroArtist) {
    try {
      await toggleArtistFollow(artist.id);
      // Refetch to replace followed artist with a new one
      refetchDiscovery();
    } catch {
      // Follow state rolls back in ArtistFollowsContext.
    }
  }

  async function loadHomePlaylist(playlistId: string) {
    return api<HomeGeneratedPlaylistDetail>(
      `/api/me/home/playlists/${encodeURIComponent(playlistId)}`,
    );
  }

  async function playHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    try {
      const playlist = await loadHomePlaylist(item.id);
      const queue = (playlist.tracks || []).map(toPlayerTrack);
      if (!queue.length) {
        toast.info(t("home.playlists.warming"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: playlist.name || item.name,
        id: playlist.id,
      });
    } catch {
      toast.error(t("home.playlists.loadFailed"));
    }
  }

  async function shuffleHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    try {
      const playlist = await loadHomePlaylist(item.id);
      const queue = (playlist.tracks || []).map(toPlayerTrack);
      if (!queue.length) {
        toast.info(t("home.playlists.warming"));
        return;
      }
      playAll(shuffleArray(queue), 0, {
        type: "playlist",
        name: playlist.name || item.name,
        id: playlist.id,
      });
    } catch {
      toast.error(t("home.playlists.loadFailed"));
    }
  }

  async function startHomePlaylistRadio(item: HomeGeneratedPlaylistSummary) {
    try {
      const radio = await fetchHomePlaylistRadio({
        playlistId: item.id,
        playlistName: item.name,
      });
      if (!radio.tracks.length) {
        toast.info(t("actions.playlist.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("actions.playlist.toasts.radioFailed"));
    }
  }

  async function acknowledgeInsight(insight: HomeUpcomingInsight) {
    try {
      await api(`/api/me/shows/${insight.show_id}/reminders`, "POST", {
        reminder_type: insight.type,
      });
      toast.success(t("home.radar.toasts.savedForLater"));
      navigate("/upcoming");
    } catch {
      toast.error(t("home.radar.toasts.saveReminderFailed"));
    }
  }

  async function playInsightSetlist(insight: HomeUpcomingInsight) {
    try {
      if (!insight.artist_id) return;
      const queue = await fetchPlayableSetlist({
        artistId: insight.artist_id,
        artistName: insight.artist,
      });
      if (!queue.length) {
        toast.info(t("artist.toasts.noSetlistMatches"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("radar.show.probableSetlistSource", {
          name: insight.artist,
        }),
      });
      await api(`/api/me/shows/${insight.show_id}/reminders`, "POST", {
        reminder_type: insight.type,
      });
      toast.success(
        t("radar.show.toasts.playingSetlist", { count: queue.length }),
      );
    } catch {
      toast.error(t("radar.show.toasts.loadSetlistFailed"));
    }
  }

  async function playUpcomingSetlist(item: HomeUpcomingItem) {
    try {
      if (item.type !== "show" || !item.artist_id) return;
      const queue = await fetchPlayableSetlist({
        artistId: item.artist_id,
        artistName: item.artist,
      });
      if (!queue.length) {
        toast.info(t("artist.toasts.noSetlistMatches"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("radar.show.probableSetlistSource", { name: item.artist }),
      });
      toast.success(
        t("radar.show.toasts.playingSetlist", { count: queue.length }),
      );
    } catch {
      toast.error(t("radar.show.toasts.loadSetlistFailed"));
    }
  }

  function playReplayMix() {
    if (!replay?.items?.length) return;
    const queue: Track[] = replay.items.map((item) =>
      toPlayableTrack(item, {
        cover:
          item.artist && item.album
            ? albumCoverApiUrl(
                {
                  albumId: item.album_id,
                  globalAlbumUid: item.global_album_uid,
                  albumEntityUid: item.album_entity_uid,
                  artistEntityUid: item.artist_entity_uid,
                  albumSlug: item.album_slug,
                  artistName: item.artist,
                  albumName: item.album,
                },
                { size: 512 },
              )
            : undefined,
      }),
    );
    playAll(queue, 0, { type: "playlist", name: replay.title });
  }

  function openReplayStats() {
    navigate(
      replayMonth
        ? `/stats?month=${encodeURIComponent(replayMonth)}`
        : "/stats",
    );
  }

  if (!currentDiscovery) {
    if (discoveryLoading || !discoveryError) {
      return <CrateLoader label={t("home.loading")} />;
    }
    return (
      <ErrorState
        message={t("search.errors.tryAgain")}
        onRetry={() => {
          refetchDiscovery();
          void refreshLiveDiscovery(true);
        }}
      />
    );
  }

  const homeIntro = (
    <div>
      <h1 className="text-3xl font-bold text-foreground">
        {getHomeGreeting(t)}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {getHomeDateString(i18n.language)}
      </p>
    </div>
  );

  return (
    <div className="w-full" {...pullHandlers}>
      <PullIndicator distance={pullDistance} refreshing={refreshing} />

      <HomeTasteHero
        heroes={heroes}
        heroSurfaces={currentDiscovery?.hero_surfaces}
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
        onPlay={(artist) => void playHeroArtist(artist)}
        onToggleFollow={(artist) => void toggleHeroFollow(artist)}
        desktopIntro={isDesktop ? homeIntro : undefined}
      />

      <div
        data-testid="home-discovery-content"
        className={`mx-auto w-full max-w-[1480px] space-y-10 px-6 pb-10 ${
          isDesktop ? "relative z-30 mt-0 pt-8 2xl:-mt-16 2xl:pt-0" : "pt-8"
        }`}
        style={{
          paddingLeft: isDesktop
            ? undefined
            : "max(1rem, var(--listen-safe-left))",
          paddingRight: isDesktop
            ? undefined
            : "max(1rem, var(--listen-safe-right))",
        }}
      >
        <RecentlyPlayedSection
          items={currentDiscovery?.recently_played || []}
          onOpenItem={(item) => navigate(openRecentItemPath(item))}
          onViewAll={openHomeSection}
        />

        {!isDesktop ? (
          <JustLandedSection
            artists={recentGlobalArtists}
            loading={globalArtistsLoading}
            onOpenExplore={() => navigate("/explore")}
          />
        ) : null}

        <SuggestedAlbumsSection
          albums={currentDiscovery?.suggested_albums || []}
          onViewAll={openHomeSection}
        />

        <UpcomingAlbumsSection
          albums={currentDiscovery?.upcoming_albums || []}
          onViewAll={openHomeSection}
        />

        {isDesktop ? (
          <RecommendedTracksSection
            tracks={recommendedTracks}
            onViewAll={openHomeSection}
          />
        ) : null}

        {isDesktop ? (
          <FavoriteArtistsSection
            artists={currentDiscovery?.favorite_artists || []}
            onViewAll={openHomeSection}
          />
        ) : null}

        {isDesktop ? (
          <EssentialsSection
            items={currentDiscovery?.essentials || []}
            onOpenPlaylist={(item) => navigate(homePlaylistPath(item.id))}
            onPlayPlaylist={(item) => void playHomePlaylist(item)}
            onShufflePlaylist={(item) => void shuffleHomePlaylist(item)}
            onStartRadio={(item) => void startHomePlaylistRadio(item)}
            onViewAll={openHomeSection}
          />
        ) : null}

        <HomeUpcomingSection
          previewItems={upcomingPreview}
          summary={upcoming?.summary}
          onOpenUpcoming={() => navigate("/upcoming")}
          onPlaySetlist={(item) => void playUpcomingSetlist(item)}
        />

        <HomeShowPrepSection
          insights={homeInsights}
          onOpenUpcoming={() => navigate("/upcoming")}
          onPlaySetlist={(insight) => void playInsightSetlist(insight)}
          onSaveReminder={(insight) => void acknowledgeInsight(insight)}
        />

        {isDesktop ? (
          <>
            <HomeReplaySection
              replay={replay || undefined}
              replayPreview={replayPreview}
              onOpenStats={openReplayStats}
              onPlayReplay={playReplayMix}
              onPlayTrack={(item) =>
                play(toPlayerTrack(item), { type: "track", name: item.title })
              }
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
