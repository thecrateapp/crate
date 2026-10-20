import { useNavigate, useSearchParams, useLocation } from "react-router";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@crate/ui/domain/states";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { notify } from "@crate/ui/lib/notify";

import {
  DecadeDetailView,
  GenreDetailView,
  PlaylistCategoryView,
} from "@/components/explore/ExploreViews";
import {
  loadSystemPlaylistTracks,
  type ExplorePageData,
} from "@/components/explore/explore-model";
import {
  ExploreCratePlaylists,
  ExploreFeatureCard,
  GenreExplorer,
  MoodBrowseSection,
} from "./ExploreLandingSections";
import { JustLandedSection } from "@/components/home/HomeLibrarySections";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useTransparentHeader } from "@/components/layout/transparent-header";

import {
  BrowseReadState,
  ExploreDecades,
} from "@/components/explore/ExploreBrowseViews";
import {
  exploreSelectionLocation,
  type ExploreSelection,
} from "@/components/explore/explore-navigation";

export function Explore() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const open = (key?: ExploreSelection, value?: string) =>
    navigate(exploreSelectionLocation(location, key, value));
  const genreSlug = searchParams.get("genre");
  useTransparentHeader(searchParams.has("genre"));
  const playlistCategory = searchParams.get("playlistCategory");

  const {
    data: explorePage,
    loading,
    error,
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
      notify.error(t("explore.toasts.playPlaylistFailed"));
    }
  }

  async function handleToggleFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(
        `/api/curation/playlists/${playlistId}/follow`,
        isFollowed ? "DELETE" : "POST",
      );
      notify.success(
        isFollowed
          ? t("explore.toasts.removedFromLibrary")
          : t("explore.toasts.addedToLibrary"),
      );
      refetch();
    } catch {
      notify.error(t("explore.toasts.updatePlaylistFailed"));
    }
  }

  const decadeParam = searchParams.get("decade");
  if (genreSlug) {
    return <GenreDetailView slug={genreSlug} onBack={() => open()} />;
  }
  if (decadeParam) {
    return <DecadeDetailView decade={decadeParam} onBack={() => open()} />;
  }
  if (playlistCategory) {
    return (
      <PlaylistCategoryView category={playlistCategory} onBack={() => open()} />
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader size="md" title={t("explore.title")} />
      <div className="space-y-6">
        <BrowseReadState
          loading={loading && !explorePage}
          error={error}
          onRetry={refetch}
        />

        {filters ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ExploreFeatureCard
                title={t("explore.features.radio.title")}
                subtitle={t("explore.features.radio.subtitle")}
                onClick={() => navigate("/radio")}
              />
              <ExploreFeatureCard
                title={t("explore.features.paths.title")}
                subtitle={t("explore.features.paths.subtitle")}
                onClick={() => navigate("/paths")}
              />
            </div>

            <JustLandedSection
              artists={explorePage?.recent_global_artists}
              loading={loading}
            />

            <GenreExplorer
              genres={filters.genres}
              onOpen={(genre) => open("genre", genre)}
            />

            <ExploreDecades
              decades={filters.decades}
              onOpen={(decade) => open("decade", decade)}
            />

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
        ) : loading || error ? null : (
          <EmptyState variant="inline" message={t("explore.noFilters")} />
        )}
      </div>
    </div>
  );
}
