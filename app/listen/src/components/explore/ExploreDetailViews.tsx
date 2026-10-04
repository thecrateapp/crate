import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { MediaGrid } from "@crate/ui/domain/lists";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { EmptyState, ErrorState } from "@crate/ui/domain/states";

import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { toast } from "sonner";

import {
  type DecadeArtists,
  type SystemPlaylist,
  loadSystemPlaylistTracks,
} from "./explore-model";
import { GenreDetailContent } from "./GenreDetailSections";
import { useGenreDetailActions } from "./use-genre-detail-actions";
import { useGenreDetailModel } from "./use-genre-detail-model";

export function GenreDetailView({
  slug,
}: {
  slug: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const model = useGenreDetailModel(slug);
  const actions = useGenreDetailActions({
    data: model.data,
    heroCoverUrl: model.heroCoverUrl,
    nextShow: model.nextShow,
  });

  if (model.loading) {
    return <CrateLoader label={t("genre.loading")} />;
  }
  if (!model.data) {
    return <ErrorState kind="notFound" message={t("genre.notFound")} />;
  }

  return (
    <GenreDetailContent
      actionBar={{
        albumCount: model.albumCount,
        artistCount: model.artistCount,
        data: model.data,
        genreMenuActions: actions.genreMenuActions,
        heroCoverUrl: model.heroCoverUrl,
        isDesktop: model.isDesktop,
        nextShow: model.nextShow,
        onOpenGenreRadar: actions.openGenreRadar,
        onPlayGenreRadio: () => void actions.handlePlayGenreRadio(),
        onShareGenre: actions.shareGenre,
        startingRadio: actions.startingRadio,
      }}
      artistCount={model.artistCount}
      artists={model.visibleArtists}
      albumCount={model.albumCount}
      albums={model.visibleAlbums}
      data={model.data}
      description={model.description}
      expandedShowId={expandedShowId}
      heroCoverUrl={model.heroCoverUrl}
      onCoverError={() => {
        if (model.heroCoverIndex + 1 < model.heroCoverCandidates.length) {
          model.setHeroCoverIndex((index) => index + 1);
        } else {
          model.setHeroCoverIndex(model.heroCoverCandidates.length);
        }
      }}
      onOpenRelated={(genre) =>
        navigate(
          `/explore?genre=${encodeURIComponent(genre.page_slug || genre.slug)}`,
        )
      }
      onToggleShow={(key) =>
        setExpandedShowId(expandedShowId === key ? null : key)
      }
      relatedGenres={model.visibleRelatedGenres}
      trackCount={model.trackCount}
    />
  );
}

export function DecadeDetailView({
  decade,
  onBack,
}: {
  decade: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data, loading } = useApi<DecadeArtists>(
    `/api/catalog/artists?decade=${encodeURIComponent(decade)}&per_page=50`,
  );

  if (loading) return <CrateLoader label={t("explore.decade.loading")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        size="md"
        back={
          <BackLink variant="icon" label={t("common.back")} onClick={onBack} />
        }
        title={decade}
        subtitle={t("common.artistCountLabel", { count: data?.total ?? 0 })}
      />

      {data && data.items.length > 0 ? (
        <MediaGrid density="compact">
          {data.items.map((artist) => (
            <ArtistCard
              key={artist.id ?? artist.global_artist_uid ?? artist.name}
              name={artist.name}
              artistId={artist.id}
              artistEntityUid={artist.entity_uid ?? undefined}
              globalArtistUid={
                artist.global_artist_uid ?? artist.global_uid ?? undefined
              }
              artistSlug={artist.slug}
              subtitle={t("common.albumCountLabel", { count: artist.albums })}
              compact
              layout="grid"
            />
          ))}
        </MediaGrid>
      ) : (
        <EmptyState variant="dashed" message={t("explore.decade.empty")} />
      )}
    </div>
  );
}

export function PlaylistCategoryView({
  category,
  onBack,
}: {
  category: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { data, loading, refetch } = useApi<SystemPlaylist[]>(
    `/api/curation/playlists/category/${encodeURIComponent(category)}`,
  );

  async function handlePlayPlaylist(playlistId: number, playlistName: string) {
    try {
      const playlist = await loadSystemPlaylistTracks(playlistId);
      if (playlist.tracks.length > 0) {
        playAll(playlist.tracks, 0, { ...playlist.source, name: playlistName });
      }
    } catch {
      toast.error(t("playlist.toasts.playFailed"));
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
          ? t("actions.playlist.toasts.removedFromLibrary")
          : t("actions.playlist.toasts.addedToLibrary"),
      );
      refetch();
    } catch {
      toast.error(t("playlist.toasts.updateFailed"));
    }
  }

  if (loading) {
    return <CrateLoader label={t("explore.playlistCategory.loading")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        size="md"
        back={
          <BackLink variant="icon" label={t("common.back")} onClick={onBack} />
        }
        title={<span className="capitalize">{category}</span>}
        subtitle={t("common.playlistCountLabel", { count: data?.length ?? 0 })}
      />

      {data && data.length > 0 ? (
        <MediaGrid>
          {data.map((playlist) => (
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
                t("common.trackCountLabel", { count: playlist.track_count }),
                playlist.follower_count > 0
                  ? t("common.followerCountLabel", {
                      count: playlist.follower_count,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              systemPlaylist
              crateManaged
              isFollowed={playlist.is_followed}
              layout="grid"
              href={`/curation/playlist/${playlist.id}`}
              onPlay={() => handlePlayPlaylist(playlist.id, playlist.name)}
              onToggleFollow={() =>
                handleToggleFollow(playlist.id, playlist.is_followed)
              }
              onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
            />
          ))}
        </MediaGrid>
      ) : (
        <EmptyState
          variant="dashed"
          message={t("explore.playlistCategory.empty")}
        />
      )}
    </div>
  );
}
