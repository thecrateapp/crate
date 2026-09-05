import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Loader2 } from "@crate/ui/icons";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { toast } from "sonner";

import {
  type DecadeArtists,
  type SearchResults,
  type SystemPlaylist,
  loadSystemPlaylistTracks,
} from "./explore-model";
import { GenreDetailContent } from "./GenreDetailSections";
import { useGenreDetailActions } from "./use-genre-detail-actions";
import { useGenreDetailModel } from "./use-genre-detail-model";

export function ExplorePill({
  label,
  count,
  onClick,
}: {
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border-quiet px-4 py-2 transition-colors hover:border-accent-action/40 hover:bg-accent-action/5"
    >
      <span className="text-sm font-medium text-accent-action">{label}</span>
      {count != null && count > 0 ? (
        <span className="text-xs text-text-muted">{count}</span>
      ) : null}
    </button>
  );
}

export function ExploreSectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          {actionLabel}
          <ArrowRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function ExploreSectionRail({ children }: { children: ReactNode }) {
  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function ExploreLoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="animate-spin text-accent-action" />
    </div>
  );
}

export function SearchResultsView({ results }: { results: SearchResults }) {
  const { t } = useTranslation();
  const hasArtists = results.artists.length > 0;
  const hasAlbums = results.albums.length > 0;
  const hasTracks = results.tracks.length > 0;
  const trackRows = useMemo<TrackRowData[]>(
    () =>
      results.tracks.slice(0, 10).map((track) => ({
        ...track,
        path: track.path || "",
        duration: track.duration || 0,
        library_track_id: track.id,
      })),
    [results.tracks],
  );

  if (!hasArtists && !hasAlbums && !hasTracks) {
    return (
      <p className="mt-8 text-sm text-text-muted">
        {t("explore.search.noResults")}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {hasArtists ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">
            {t("nav.collection.artists")}
          </h2>
          <ExploreSectionRail>
            {results.artists.map((artist) => (
              <ArtistCard
                key={artist.id ?? artist.name}
                name={artist.name}
                artistId={artist.id}
                artistSlug={artist.slug}
                subtitle={
                  artist.album_count
                    ? t("common.albumCountLabel", {
                        count: artist.album_count,
                      })
                    : undefined
                }
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasAlbums ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">
            {t("nav.collection.albums")}
          </h2>
          <ExploreSectionRail>
            {results.albums.map((album) => (
              <AlbumCard
                key={album.id || `${album.artist}-${album.name}`}
                artist={album.artist}
                album={album.name}
                albumId={album.id}
                albumSlug={album.slug}
                year={album.year}
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasTracks ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">{t("common.tracks")}</h2>
          <div className="rounded-xl border border-border-quiet bg-surface-quiet-subtle">
            {trackRows.map((row, index) => (
              <TrackRow
                key={`${row.artist}-${row.title}-${index}`}
                track={row}
                index={index + 1}
                showArtist
                showAlbum
                queueTracks={trackRows}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
    return <p className="text-sm text-text-muted">{t("genre.notFound")}</p>;
  }

  return (
    <GenreDetailContent
      actionBar={{
        albumCount: model.albumCount,
        artistCount: model.artistCount,
        data: model.data,
        genreMenu: actions.genreMenu,
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
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-text-primary/50 transition-colors hover:bg-text-primary/5 hover:text-text-primary"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{decade}</h1>
          <p className="text-sm text-text-muted">
            {t("common.artistCountLabel", { count: data?.total ?? 0 })}
          </p>
        </div>
      </div>

      {data && data.items.length > 0 ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
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
        </div>
      ) : (
        <p className="text-sm text-text-muted">{t("explore.decade.empty")}</p>
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
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-text-primary/50 transition-colors hover:bg-text-primary/5 hover:text-text-primary"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold capitalize">{category}</h1>
          <p className="text-sm text-text-muted">
            {t("common.playlistCountLabel", { count: data?.length ?? 0 })}
          </p>
        </div>
      </div>

      {data && data.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border-quiet px-4 py-6 text-sm text-text-muted">
          {t("explore.playlistCategory.empty")}
        </div>
      )}
    </div>
  );
}
