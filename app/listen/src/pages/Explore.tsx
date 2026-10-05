import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Radio, Route } from "@crate/ui/icons";
import { SectionHeader } from "@crate/ui/domain/lists";
import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { notify } from "@crate/ui/lib/notify";

import {
  DecadeDetailView,
  ExplorePill,
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

export function Explore() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");
  useTransparentHeader(searchParams.has("genre"));
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
      <PageHeader size="md" title={t("explore.title")} />
      <div className="space-y-6">
        {loading ? <LoadingState label={t("common.loadingShort")} /> : null}

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

            <JustLandedSection
              artists={explorePage?.recent_global_artists}
              loading={loading}
            />

            <GenreExplorer
              genres={filters.genres}
              onOpen={(genre) =>
                setSearchParams({
                  genre: genre.toLowerCase().replace(/\s+/g, "-"),
                })
              }
            />

            {filters.decades.length > 0 && (
              <div className="space-y-4">
                <SectionHeader
                  title={t("explore.timeTunnels.title")}
                  subtitle={t("explore.timeTunnels.subtitle")}
                />
                <div className="flex flex-wrap gap-2">
                  {filters.decades.map((decade) => (
                    <ExplorePill
                      key={decade}
                      label={decade}
                      count={0}
                      onClick={() => setSearchParams({ decade })}
                    />
                  ))}
                </div>
              </div>
            )}

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
        ) : loading ? null : (
          <EmptyState variant="inline" message={t("explore.noFilters")} />
        )}
      </div>
    </div>
  );
}
