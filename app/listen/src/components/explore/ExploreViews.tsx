import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CRATE_ICON_SIZE,
  Loader2,
  MoreHorizontal,
  Play,
  Radio,
  Share2,
} from "@crate/ui/icons";
import {
  ItemActionMenu,
  type ItemActionMenuEntry,
  useItemActionMenu,
} from "@crate/ui/domain/actions";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { toast } from "sonner";

import { action } from "@/components/actions/shared";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import {
  itemKey,
  UpcomingShowCard,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { startShapedRadio } from "@/lib/radio";

import {
  type DecadeArtists,
  type GenreDetail,
  type SearchResults,
  type SystemPlaylist,
  loadSystemPlaylistTracks,
} from "./explore-model";

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
      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span className="text-sm font-medium text-primary">{label}</span>
      {count != null && count > 0 ? (
        <span className="text-xs text-muted-foreground">{count}</span>
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
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
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
      <Loader2 size={24} className="animate-spin text-primary" />
    </div>
  );
}

export function SearchResultsView({ results }: { results: SearchResults }) {
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
      <p className="mt-8 text-sm text-muted-foreground">No results found.</p>
    );
  }

  return (
    <div className="space-y-8">
      {hasArtists ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">Artists</h2>
          <ExploreSectionRail>
            {results.artists.map((artist) => (
              <ArtistCard
                key={artist.id ?? artist.name}
                name={artist.name}
                artistId={artist.id}
                artistSlug={artist.slug}
                subtitle={
                  artist.album_count
                    ? `${artist.album_count} albums`
                    : undefined
                }
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasAlbums ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">Albums</h2>
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
          <h2 className="px-1 text-lg font-bold">Tracks</h2>
          <div className="rounded-xl border border-white/5 bg-white/[0.02]">
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
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const isDesktop = useIsDesktop();
  const [startingRadio, setStartingRadio] = useState(false);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const { data, loading } = useApi<GenreDetail>(
    `/api/genres/${slug}?view=genre-detail-v5`,
  );
  const genreShows = data?.shows?.slice(0, 5) ?? [];
  const nextShow = genreShows[0] ?? null;
  const heroCoverUrl = upscaleGenreCoverUrl(
    data?.cover_url,
    data?.canonical_slug || data?.slug,
  );

  async function handlePlayGenreRadio() {
    if (!data || startingRadio) return;
    const seedSlug = data.canonical_slug || data.slug;
    setStartingRadio(true);
    try {
      const radio = await startShapedRadio("seeded", "genre", seedSlug);
      if (!radio?.tracks.length) {
        toast.info("Genre radio is not available yet");
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error("Failed to start genre radio");
    } finally {
      setStartingRadio(false);
    }
  }

  function openGenreRadar(show?: UpcomingItem | null) {
    if (!data) return;
    const params = new URLSearchParams({ genre: data.slug });
    if (show?.id != null) params.set("show", String(show.id));
    navigate(`/upcoming?${params.toString()}`);
  }

  async function shareGenre() {
    if (!data) return;
    const url = `${window.location.origin}/explore?genre=${encodeURIComponent(
      data.slug,
    )}`;
    const title = `${data.name} on Crate`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard?.writeText(url);
        toast.success("Genre link copied");
      }
    } catch {
      toast.error("Could not share genre");
    }
  }

  const genreMenuActions = useMemo<ItemActionMenuEntry[]>(() => {
    if (!data) return [];
    return [
      action({
        key: "play-radio",
        label: "Play genre radio",
        icon: Radio,
        onSelect: handlePlayGenreRadio,
      }),
      action({
        key: "radar",
        label: nextShow ? "Open next show in Radar" : "Open genre Radar",
        icon: Calendar,
        disabled: !nextShow,
        onSelect: () => openGenreRadar(nextShow),
      }),
      action({
        key: "share",
        label: "Share genre",
        icon: Share2,
        onSelect: shareGenre,
      }),
    ];
  }, [data, nextShow, startingRadio]);
  const genreMenu = useItemActionMenu(genreMenuActions);

  if (loading) return <ExploreLoadingState />;
  if (!data)
    return <p className="text-sm text-muted-foreground">Genre not found.</p>;

  const description =
    data.description ||
    data.canonical_description ||
    data.external_description ||
    "A focused corner of your library, shaped by the artists and records you keep returning to.";
  const artistCount = data.artist_count ?? data.artists.length;
  const albumCount = data.album_count ?? data.albums.length;
  const trackCount =
    data.track_count ??
    data.albums.reduce((total, album) => total + (album.track_count || 0), 0);
  const visibleArtists = isDesktop ? data.artists : data.artists.slice(0, 12);
  const visibleAlbums = isDesktop ? data.albums : data.albums.slice(0, 12);
  const genreMenuTrigger =
    typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed z-app-header"
            style={{
              top: "calc(var(--listen-safe-top) + 0.625rem)",
              right: "max(1rem, var(--listen-safe-right))",
            }}
          >
            <button
              ref={genreMenu.triggerRef}
              type="button"
              data-testid="genre-mobile-hero-menu"
              className="flex h-11 w-11 touch-manipulation items-center justify-center text-white/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.32)]"
              onClick={genreMenu.openFromTrigger}
              onContextMenu={genreMenu.handleContextMenu}
              aria-label="Genre actions"
              title="Genre actions"
            >
              <MoreHorizontal
                data-testid="genre-mobile-hero-menu-icon"
                size={CRATE_ICON_SIZE.navMobile}
                className="rotate-90"
              />
            </button>
            <ItemActionMenu
              actions={genreMenuActions}
              header={{
                type: "media",
                title: data.name,
                subtitle: "Genre",
                detail: `${artistCount} artists · ${albumCount} albums`,
                imageUrl: heroCoverUrl,
                imageAlt: data.name,
                imageShape: "square",
                fallbackIcon: Radio,
              }}
              open={genreMenu.open}
              position={genreMenu.position}
              menuRef={genreMenu.menuRef}
              onClose={genreMenu.close}
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {genreMenuTrigger}
      <div className="space-y-6">
        <section className="relative -mx-4 -mt-4 h-[420px] overflow-hidden sm:-mx-6 sm:-mt-6 sm:h-[400px] lg:-mx-8 lg:-mt-8">
          {heroCoverUrl ? (
            <img
              src={heroCoverUrl}
              alt={`${data.name} genre cover`}
              className="absolute inset-0 h-full w-full scale-[1.02] object-cover brightness-[0.66] contrast-110 opacity-[0.68] saturate-125"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <div className="absolute inset-0 bg-black/22" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, transparent 0%, rgba(8, 10, 14, 0.14) 34%, rgba(8, 10, 14, 0.46) 60%, var(--surface-app) 100%)",
            }}
          />
          <div className="relative mx-auto flex h-full w-full max-w-[1480px] flex-col px-4 pb-6 pt-[var(--listen-mobile-page-top)] sm:px-6 sm:pt-6">
            <div className="mt-auto max-w-3xl pb-1">
              <h1 className="text-4xl font-black leading-none tracking-tight text-white sm:text-6xl">
                {data.name}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/68 sm:text-base sm:leading-7">
                {description}
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/56">
                <span>{artistCount} artists</span>
                <span className="text-white/20">/</span>
                <span>{albumCount} albums</span>
                <span className="text-white/20">/</span>
                <span>{trackCount} tracks</span>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => void handlePlayGenreRadio()}
                  disabled={startingRadio}
                  aria-label="Play genre radio"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-bold text-black shadow-[0_0_24px_rgba(34,211,238,0.28)] transition-[filter,transform,box-shadow] hover:-translate-y-px hover:shadow-[0_0_34px_rgba(34,211,238,0.40)] disabled:cursor-wait disabled:opacity-70"
                >
                  {startingRadio ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Play size={17} />
                  )}
                  <span>Play</span>
                </button>
                {nextShow ? (
                  <button
                    type="button"
                    onClick={() => openGenreRadar(nextShow)}
                    aria-label="Open next genre show in Radar"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-7 text-sm font-bold text-white shadow-[0_16px_36px_rgba(0,0,0,0.22)] backdrop-blur-md transition-[border-color,color,filter,transform] hover:-translate-y-px hover:border-primary/35 hover:text-primary hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.28)]"
                  >
                    <Calendar size={17} />
                    <span>Next show</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {genreShows.length > 0 ? (
          <section className="space-y-3">
            <h2 className="px-1 text-lg font-bold">Shows</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {genreShows.map((show, index) => {
                const key = itemKey(show, index);
                return (
                  <UpcomingShowCard
                    key={key}
                    item={show}
                    expanded={expandedShowId === key}
                    onToggle={() =>
                      setExpandedShowId(expandedShowId === key ? null : key)
                    }
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        {visibleArtists.length > 0 ? (
          <div className="space-y-3">
            <h2 className="px-1 text-lg font-bold">Artists</h2>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {visibleArtists.map((artist) => (
                <ArtistCard
                  key={artist.artist_id ?? artist.artist_name}
                  name={artist.artist_name}
                  artistId={artist.artist_id}
                  artistSlug={artist.artist_slug}
                  subtitle={`${artist.album_count} albums`}
                  compact
                  layout="grid"
                />
              ))}
            </div>
          </div>
        ) : null}

        {visibleAlbums.length > 0 ? (
          <div className="space-y-3">
            <h2 className="px-1 text-lg font-bold">Albums</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {visibleAlbums.map((album) => (
                <AlbumCard
                  key={album.album_id || `${album.artist}-${album.name}`}
                  artist={album.artist}
                  album={album.name}
                  albumId={album.album_id}
                  albumSlug={album.album_slug}
                  year={album.year}
                  layout="grid"
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function upscaleGenreCoverUrl(
  url?: string | null,
  fallbackSlug?: string | null,
) {
  const candidate =
    url ||
    (fallbackSlug
      ? `/api/genres/${encodeURIComponent(
          fallbackSlug,
        )}/cover?size=1280&format=webp`
      : null);
  const resolved = resolveMaybeApiAssetUrl(candidate);
  if (!resolved) return null;
  const sized = resolved.replace(
    /([?&]size=)640\b/,
    (_, prefix: string) => `${prefix}1280`,
  );
  return `${sized}${sized.includes("?") ? "&" : "?"}hero=genre-detail-v5`;
}

export function DecadeDetailView({
  decade,
  onBack,
}: {
  decade: string;
  onBack: () => void;
}) {
  const { data, loading } = useApi<DecadeArtists>(
    `/api/artists?decade=${decade}&limit=50`,
  );

  if (loading) return <ExploreLoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{decade}</h1>
          <p className="text-sm text-muted-foreground">
            {data?.total ?? 0} artists
          </p>
        </div>
      </div>

      {data && data.items.length > 0 ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {data.items.map((artist) => (
            <ArtistCard
              key={artist.id ?? artist.name}
              name={artist.name}
              artistId={artist.id}
              artistSlug={artist.slug}
              subtitle={`${artist.albums} albums`}
              compact
              layout="grid"
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No artists found for this decade.
        </p>
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

  if (loading) return <ExploreLoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold capitalize">{category}</h1>
          <p className="text-sm text-muted-foreground">
            {data?.length ?? 0} playlists
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
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
          No playlists found in this category yet.
        </div>
      )}
    </div>
  );
}
