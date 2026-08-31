import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
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
} from "@/components/actions/ItemActionMenu";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { toast } from "sonner";

import { action } from "@/components/actions/shared";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { CrateImage } from "@/components/artwork/CrateImage";
import { CrateLoader } from "@/components/ui/CrateLoader";
import {
  itemKey,
  UpcomingShowCard,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { startShapedRadio } from "@/lib/radio";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";

import {
  type DecadeArtists,
  type GenreDetail,
  type SearchResults,
  type SystemPlaylist,
  loadSystemPlaylistTracks,
} from "./explore-model";
import {
  artistBackgroundApiUrl,
  artistPhotoApiUrl,
  genreCoverApiUrl,
} from "@/lib/library-routes";

const GENRE_SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

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
          <div className="rounded-xl border border-border-quiet bg-text-primary/[0.02]">
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
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const isDesktop = useIsDesktop();
  const [startingRadio, setStartingRadio] = useState(false);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const { data, loading } = useApi<GenreDetail>(
    `/api/catalog/genres/${slug}`,
    "GET",
    undefined,
    { revalidateIfCached: "never" },
  );
  const primaryArtists = useMemo(
    () =>
      (data?.artists ?? []).filter(
        (artist) => artist.membership !== "inherited",
      ),
    [data?.artists],
  );
  const primaryAlbums = useMemo(
    () =>
      (data?.albums ?? []).filter((album) => album.membership !== "inherited"),
    [data?.albums],
  );
  const genreShows = data?.shows?.slice(0, 5) ?? [];
  const nextShow = genreShows[0] ?? null;
  const fallbackGenreSlug = data?.canonical_slug || data?.slug;
  const heroCoverCandidates = useMemo(
    () =>
      buildGenreHeroCoverCandidates(
        data?.cover_url,
        fallbackGenreSlug,
        primaryArtists,
      ),
    [data?.cover_url, fallbackGenreSlug, primaryArtists],
  );
  const heroCoverFingerprint = heroCoverCandidates.join("|");
  const [heroCoverIndex, setHeroCoverIndex] = useState(0);
  useEffect(() => {
    setHeroCoverIndex(0);
  }, [heroCoverFingerprint]);
  const heroCoverUrl = heroCoverCandidates[heroCoverIndex] ?? null;

  async function handlePlayGenreRadio() {
    if (!data || startingRadio) return;
    const seedSlug = data.canonical_slug || data.slug;
    setStartingRadio(true);
    try {
      const radio = await startShapedRadio("seeded", "genre", seedSlug);
      if (!radio?.tracks.length) {
        toast.info(t("genre.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("genre.toasts.radioFailed"));
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

  function shareGenre() {
    if (!data) return;
    openShareSheet({
      kind: "genre",
      title: data.name,
      subtitle: t("genre.kind"),
      imageUrl: heroCoverUrl,
      url: publicShareUrl(`/explore?genre=${encodeURIComponent(data.slug)}`),
    });
  }

  const genreMenuActions = useMemo<ItemActionMenuEntry[]>(() => {
    if (!data) return [];
    return [
      action({
        key: "play-radio",
        label: t("genre.actions.playRadio"),
        icon: Radio,
        onSelect: handlePlayGenreRadio,
      }),
      action({
        key: "radar",
        label: nextShow
          ? t("genre.actions.openNextShow")
          : t("genre.actions.openRadar"),
        icon: Calendar,
        disabled: !nextShow,
        onSelect: () => openGenreRadar(nextShow),
      }),
      action({
        key: "share",
        label: t("genre.actions.share"),
        icon: Share2,
        onSelect: shareGenre,
      }),
    ];
  }, [data, heroCoverUrl, nextShow, startingRadio, t]);
  const genreMenu = useItemActionMenu(genreMenuActions);

  if (loading) return <CrateLoader label={t("genre.loading")} />;
  if (!data)
    return <p className="text-sm text-text-muted">{t("genre.notFound")}</p>;

  const description =
    data.description ||
    data.canonical_description ||
    data.external_description ||
    t("genre.defaultDescription");
  const hasArtistMemberships = data.artists.some((artist) => artist.membership);
  const hasAlbumMemberships = data.albums.some((album) => album.membership);
  const artistCount = hasArtistMemberships
    ? primaryArtists.length
    : data.artist_count ?? primaryArtists.length;
  const albumCount = hasAlbumMemberships
    ? primaryAlbums.length
    : data.album_count ?? primaryAlbums.length;
  const directAlbumTrackCount = primaryAlbums.reduce(
    (total, album) => total + (album.track_count || 0),
    0,
  );
  const trackCount = hasAlbumMemberships
    ? directAlbumTrackCount
    : data.track_count ?? directAlbumTrackCount;
  const visibleArtists = isDesktop
    ? primaryArtists
    : primaryArtists.slice(0, 12);
  const visibleAlbums = isDesktop ? primaryAlbums : primaryAlbums.slice(0, 12);
  const visibleRelatedGenres = (data.related_genres ?? []).slice(
    0,
    isDesktop ? 12 : 6,
  );
  const genreMenuTrigger =
    !isDesktop && typeof document !== "undefined"
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
              className="flex h-11 w-11 touch-manipulation items-center justify-center text-text-primary/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover"
              onClick={genreMenu.openFromTrigger}
              onContextMenu={genreMenu.handleContextMenu}
              aria-label={t("common.more")}
              title={t("common.more")}
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
                subtitle: t("genre.kind"),
                detail: t("genre.menu.detail", {
                  artists: artistCount,
                  albums: albumCount,
                }),
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
        <section className="relative -mx-4 -mt-4 h-[420px] overflow-hidden sm:-mx-6 sm:-mt-6 sm:h-[400px] lg:-mt-8">
          {heroCoverUrl ? (
            <CrateImage
              key={heroCoverUrl}
              src={heroCoverUrl}
              alt={t("genre.coverAlt", { name: data.name })}
              decoding="async"
              fetchPriority="high"
              className="absolute inset-0 h-full w-full scale-[1.02] object-cover brightness-[0.66] contrast-110 opacity-[0.68] saturate-125"
              onError={() => {
                if (heroCoverIndex + 1 < heroCoverCandidates.length) {
                  setHeroCoverIndex((index) => index + 1);
                } else {
                  setHeroCoverIndex(heroCoverCandidates.length);
                }
              }}
            />
          ) : null}
          <div className="explore-genre-hero-scrim absolute inset-0" />
          <div className="explore-genre-hero-gradient absolute inset-0" />
          <div className="relative mx-auto flex h-full w-full max-w-[1480px] flex-col px-4 pb-6 pt-[var(--listen-mobile-page-top)] sm:px-6 sm:pt-6">
            <div className="mt-auto max-w-3xl pb-1">
              <h1 className="text-4xl font-black leading-none tracking-tight text-text-primary sm:text-6xl">
                {data.name}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-text-primary/68 sm:text-base sm:leading-7">
                {description}
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-primary/56">
                <span>
                  {t("common.artistCountLabel", { count: artistCount })}
                </span>
                <span className="text-text-primary/20">/</span>
                <span>
                  {t("common.albumCountLabel", { count: albumCount })}
                </span>
                <span className="text-text-primary/20">/</span>
                <span>
                  {t("common.trackCountLabel", { count: trackCount })}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="px-0 py-1 sm:px-0">
          <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-6">
            <div
              role="group"
              aria-label={t("genre.actions.primaryGroup")}
              className="grid grid-cols-2 gap-3 md:flex md:shrink-0 md:items-center md:gap-3"
            >
              <button
                type="button"
                onClick={() => void handlePlayGenreRadio()}
                disabled={startingRadio}
                aria-label={t("genre.actions.playRadio")}
                className="explore-genre-primary-action flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-accent-action px-5 text-sm font-semibold text-accent-action-foreground shadow-accent-action-glow transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-accent-action/90 hover:shadow-accent-action-strong disabled:cursor-wait disabled:opacity-70 md:px-7 md:text-[15px]"
              >
                {startingRadio ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
                <span>{t("player.play")}</span>
              </button>
              {nextShow ? (
                <button
                  type="button"
                  onClick={() => openGenreRadar(nextShow)}
                  aria-label={t("genre.actions.openNextGenreShow")}
                  className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-text-primary/[0.08] px-5 text-sm font-semibold text-text-primary shadow-[inset_0_0_0_1px_var(--border-quiet)] transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-text-primary/[0.12] hover:text-accent-action hover:drop-shadow-accent-action md:w-auto md:px-7"
                >
                  <Calendar size={17} />
                  <span>{t("genre.actions.nextShow")}</span>
                </button>
              ) : null}
            </div>

            {isDesktop ? (
              <div
                role="group"
                aria-label={t("genre.actions.secondaryGroup")}
                className="ml-auto flex shrink-0 items-center gap-4"
              >
                <button
                  type="button"
                  className={GENRE_SECONDARY_ACTION_CLASS}
                  onClick={shareGenre}
                  aria-label={t("genre.actions.share")}
                >
                  <Share2 size={CRATE_ICON_SIZE.lg} />
                  <span>{t("common.share")}</span>
                </button>
                <div className="relative shrink-0">
                  <button
                    ref={genreMenu.triggerRef}
                    type="button"
                    className={GENRE_SECONDARY_ACTION_CLASS}
                    onClick={genreMenu.openFromTrigger}
                    onContextMenu={genreMenu.handleContextMenu}
                    aria-label={t("common.more")}
                  >
                    <MoreHorizontal size={CRATE_ICON_SIZE.lg} />
                    <span>{t("common.more")}</span>
                  </button>
                  <ItemActionMenu
                    actions={genreMenuActions}
                    header={{
                      type: "media",
                      title: data.name,
                      subtitle: t("genre.kind"),
                      detail: t("genre.menu.detail", {
                        artists: artistCount,
                        albums: albumCount,
                      }),
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
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {visibleRelatedGenres.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <h2 className="text-lg font-bold">
                  {t("genre.related.title")}
                </h2>
                <p className="mt-1 text-xs text-text-muted">
                  {t("genre.related.subtitle")}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {visibleRelatedGenres.map((genre) => (
                <RelatedGenreCard
                  key={`${genre.relation_type}-${genre.slug}`}
                  genre={genre}
                  onOpen={() =>
                    navigate(
                      `/explore?genre=${encodeURIComponent(
                        genre.page_slug || genre.slug,
                      )}`,
                    )
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        {genreShows.length > 0 ? (
          <section className="space-y-3">
            <h2 className="px-1 text-lg font-bold">
              {t("genre.sections.shows")}
            </h2>
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
            <h2 className="px-1 text-lg font-bold">
              {t("nav.collection.artists")}
            </h2>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {visibleArtists.map((artist) => (
                <ArtistCard
                  key={
                    artist.global_artist_uid ??
                    artist.artist_id ??
                    artist.artist_name
                  }
                  name={artist.artist_name}
                  artistId={artist.artist_id}
                  artistEntityUid={artist.artist_entity_uid}
                  globalArtistUid={artist.global_artist_uid}
                  artistSlug={artist.artist_slug}
                  photo={artist.photo_url ?? undefined}
                  hasPhoto={artist.has_photo}
                  subtitle={t("common.albumCountLabel", {
                    count: artist.album_count,
                  })}
                  compact
                  layout="grid"
                />
              ))}
            </div>
          </div>
        ) : null}

        {visibleAlbums.length > 0 ? (
          <div className="space-y-3">
            <h2 className="px-1 text-lg font-bold">
              {t("nav.collection.albums")}
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {visibleAlbums.map((album) => (
                <AlbumCard
                  key={
                    album.global_album_uid ??
                    album.album_id ??
                    `${album.artist}-${album.name}`
                  }
                  artist={album.artist}
                  album={album.name}
                  albumId={album.album_id ?? undefined}
                  albumEntityUid={album.album_entity_uid}
                  globalAlbumUid={album.global_album_uid}
                  artistEntityUid={album.artist_entity_uid}
                  albumSlug={album.album_slug}
                  year={album.year}
                  cover={album.cover_url ?? undefined}
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

type RelatedGenre = NonNullable<GenreDetail["related_genres"]>[number];

function RelatedGenreCard({
  genre,
  onOpen,
}: {
  genre: RelatedGenre;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const imageCandidates = useMemo(
    () => buildRelatedGenreImageCandidates(genre),
    [genre],
  );
  const imageFingerprint = imageCandidates.join("|");
  const [imageIndex, setImageIndex] = useState(0);
  useEffect(() => {
    setImageIndex(0);
  }, [imageFingerprint]);

  const coverUrl = imageCandidates[imageIndex] ?? null;
  const contentLabel = [
    genre.artist_count > 0
      ? t("common.artistCountLabel", { count: genre.artist_count })
      : null,
    genre.album_count > 0
      ? t("common.albumCountLabel", { count: genre.album_count })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="explore-related-genre-card group relative isolate min-h-[132px] overflow-hidden rounded-lg p-3 text-left transition-[border-color,filter,transform] hover:-translate-y-px"
    >
      {coverUrl ? (
        <CrateImage
          src={coverUrl}
          alt=""
          className="absolute inset-0 -z-10 h-full w-full scale-[1.04] object-cover opacity-35 saturate-125 transition duration-300 group-hover:opacity-45"
          decoding="async"
          loading="eager"
          onError={() => {
            if (imageIndex + 1 < imageCandidates.length) {
              setImageIndex((index) => index + 1);
            } else {
              setImageIndex(imageCandidates.length);
            }
          }}
        />
      ) : null}
      <div className="explore-related-genre-overlay absolute inset-0 -z-10" />
      <div className="flex h-full min-h-[108px] flex-col justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-action/85">
            {genre.relation_label}
          </div>
          <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-text-primary">
            {genre.name}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-text-muted">
            {contentLabel}
          </span>
          <ArrowRight
            size={14}
            className="shrink-0 text-text-primary/35 transition group-hover:translate-x-0.5 group-hover:text-accent-action"
          />
        </div>
      </div>
    </button>
  );
}

function buildRelatedGenreImageCandidates(genre: RelatedGenre) {
  const topArtistPhoto = genre.top_artist_global_uid
    ? artistPhotoApiUrl(
        {
          artistId: genre.top_artist_id,
          globalArtistUid: genre.top_artist_global_uid,
        },
        { size: 640, format: "webp" },
      )
    : resolveMaybeApiAssetUrl(genre.top_artist_photo_url);
  const candidates = [
    resolveGenreCoverCandidate(genre.cover_url, 640),
    topArtistPhoto ? null : relatedGenreCoverUrl(genre.page_slug),
    topArtistPhoto ? null : relatedGenreCoverUrl(genre.slug),
    topArtistPhoto,
  ].filter((url): url is string => Boolean(url));

  return [...new Set(candidates)];
}

function relatedGenreCoverUrl(slug?: string | null) {
  const normalizedSlug = slug?.trim();
  if (!normalizedSlug) return null;
  return genreCoverApiUrl(normalizedSlug, { size: 640, format: "webp" });
}

function genreCoverSlugFromUrl(url?: string | null) {
  const match = url?.match(/\/api\/genres\/([^/?]+)\/cover(?:\?|$)/);
  if (!match) return null;
  const encodedSlug = match[1];
  if (!encodedSlug) return null;
  try {
    return decodeURIComponent(encodedSlug);
  } catch {
    return encodedSlug;
  }
}

function resolveGenreCoverCandidate(
  url: string | null | undefined,
  size: number,
) {
  if (!url) return null;
  const genreSlug = genreCoverSlugFromUrl(url);
  if (genreSlug) {
    return genreCoverApiUrl(genreSlug, { size, format: "webp" });
  }
  if (/\/api\/catalog\/artists\/[^/?]+\/background(?:\?|$)/.test(url)) {
    return null;
  }
  return resolveMaybeApiAssetUrl(url);
}

function upscaleGenreCoverUrl(
  url?: string | null,
  fallbackSlug?: string | null,
) {
  const genreSlug = genreCoverSlugFromUrl(url) || (!url ? fallbackSlug : null);
  if (genreSlug) {
    return genreCoverApiUrl(genreSlug, { size: 1280, format: "webp" });
  }
  const candidate = url || null;
  const resolved = resolveMaybeApiAssetUrl(candidate);
  if (!resolved) return null;
  const sized = resolved.replace(
    /([?&]size=)640\b/,
    (_, prefix: string) => `${prefix}1280`,
  );
  return sized;
}

function buildGenreHeroCoverCandidates(
  url?: string | null,
  fallbackSlug?: string | null,
  artists?: GenreDetail["artists"],
) {
  const generatedArtistCover = Boolean(
    url &&
      /\/api\/catalog\/artists\/[^/?]+\/(?:background|photo)(?:\?|$)/.test(url),
  );
  const primary = generatedArtistCover ? null : upscaleGenreCoverUrl(url);
  const fallbackArtistBackground =
    buildGenreHeroArtistBackgroundFallback(artists);
  const fallback =
    !generatedArtistCover && url && fallbackSlug
      ? upscaleGenreCoverUrl(undefined, fallbackSlug)
      : null;

  const candidates: string[] = [];

  if (primary) candidates.push(primary);
  if (fallback) candidates.push(fallback);
  if (fallbackArtistBackground) candidates.push(fallbackArtistBackground);

  return [...new Set(candidates)];
}

function buildGenreHeroArtistBackgroundFallback(
  artists?: GenreDetail["artists"],
) {
  if (!artists?.length) return null;
  const topArtist = artists[0];

  if (
    !topArtist?.has_photo ||
    (!topArtist.artist_id && !topArtist.global_artist_uid)
  ) {
    return null;
  }

  const resolved = artistBackgroundApiUrl(
    {
      artistId: topArtist.artist_id,
      globalArtistUid: topArtist.global_artist_uid,
      artistEntityUid: topArtist.artist_entity_uid,
    },
    {
      size: 1280,
      format: "webp",
    },
  );

  if (!resolved) return null;
  return resolved;
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
