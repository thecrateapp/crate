import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { ArtistBioModal } from "@/components/artist/ArtistBioModal";
import { ArtistHeroSection } from "@/components/artist/ArtistHeroSection";
import { ArtistSetlistModal } from "@/components/artist/ArtistSetlistSection";
import {
  ArtistAlbumsSection,
  ArtistAppearsOnSection,
  ArtistShowsSection,
  ArtistTopTracksSection,
  RelatedArtistsSection,
} from "@/components/artist/ArtistPageSections";
import {
  buildArtistAlbumCover,
  type ArtistPageData,
  type ArtistPageEnrichment,
  buildArtistPhotoUrl,
  buildArtistPlayerTrack,
  buildArtistShowItems,
  sortArtistAlbumsByYear,
  type ArtistData,
  type ArtistInfo,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import { type ArtistShowEvent } from "@/components/upcoming/UpcomingRows";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { fetchArtistRadio } from "@/lib/radio";
import { shuffleArray } from "@/lib/utils";
import {
  artistBackgroundApiUrl,
  globalArtistUidFromRouteRef,
  artistPagePath,
  artistPhotoApiUrl,
  artistSharePath,
} from "@/lib/library-routes";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { Button } from "@crate/ui/shadcn/button";

export function Artist() {
  const { t } = useTranslation();
  const { artistSlug: routeArtistSlug, globalArtistUid: routeGlobalArtistRef } =
    useParams<{ artistSlug?: string; globalArtistUid?: string }>();
  const routeGlobalArtistUid =
    globalArtistUidFromRouteRef(routeGlobalArtistRef);
  const navigate = useNavigate();
  const location = useLocation();
  const [bioModalOpen, setBioModalOpen] = useState(false);
  const [setlistModalOpen, setSetlistModalOpen] = useState(false);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const { playAll } = usePlayerActions();

  const {
    data: pageData,
    loading,
    error,
    status,
    refetch,
  } = useApi<ArtistPageData>(
    routeGlobalArtistUid
      ? `/api/catalog/artists/${encodeURIComponent(routeGlobalArtistUid)}/page`
      : routeArtistSlug
        ? `/api/artist-slugs/${encodeURIComponent(
            routeArtistSlug,
          )}/page?top_tracks_count=50`
        : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const data: ArtistData | undefined = pageData?.artist;

  useEffect(() => {
    if (!data?.name) return;
    if (routeGlobalArtistUid) {
      const canonicalPath = artistPagePath({
        artistId: data.id,
        artistEntityUid: data.entity_uid,
        globalArtistUid: routeGlobalArtistUid,
        artistSlug: data.slug,
        artistName: data.name,
      });
      if (location.pathname !== canonicalPath) {
        navigate(canonicalPath, { replace: true });
      }
      return;
    }
    const canonicalPath = artistPagePath({
      artistId: data.id,
      artistSlug: data.slug,
      artistName: data.name,
    });
    if (location.pathname !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [
    data?.id,
    data?.name,
    data?.slug,
    location.pathname,
    navigate,
    routeGlobalArtistUid,
  ]);

  async function toggleFollow() {
    const globalArtistUid =
      routeGlobalArtistUid ?? data?.global_artist_uid ?? data?.global_uid;
    if (!data?.id && !globalArtistUid) return;
    try {
      const following = isFollowing(data?.id, globalArtistUid);
      await toggleArtistFollow(data?.id, globalArtistUid, data?.name);
      toast.success(
        following
          ? t("artist.toasts.unfollowed", { name: data?.name })
          : t("artist.toasts.following", { name: data?.name }),
      );
    } catch {
      toast.error(t("artist.toasts.followFailed"));
    }
  }

  async function handleShare() {
    const globalArtistUid =
      routeGlobalArtistUid ?? data?.global_artist_uid ?? data?.global_uid;
    if (!data?.id && !globalArtistUid) return;
    const shareUrl = publicShareUrl(
      artistSharePath({
        artistId: data?.id,
        artistEntityUid: data?.entity_uid,
        globalArtistUid,
        artistSlug: data?.slug,
        artistName: data?.name,
      }),
    );
    openShareSheet({
      kind: "artist",
      title: data?.name || t("artist.fallbackName"),
      imageUrl:
        data?.has_photo === false
          ? null
          : artistPhotoApiUrl(
              {
                artistId: data?.id,
                globalArtistUid,
                artistSlug: data?.slug,
                artistName: data?.name,
              },
              { size: 512, version: data?.updated_at ?? undefined },
            ),
      url: shareUrl,
    });
  }
  const info: ArtistInfo | undefined = pageData?.info;
  const topTracks: ArtistTopTrack[] = pageData?.top_tracks ?? [];
  const showsData: { events: ArtistShowEvent[] } | undefined = pageData?.shows;
  const enrichment: ArtistPageEnrichment | undefined = pageData?.enrichment;

  const coverFallback = data?.albums?.[0]
    ? buildArtistAlbumCover(
        data.name,
        data.albums[0]!.name,
        typeof data.albums[0]!.id === "number" ? data.albums[0]!.id : null,
        data.albums[0]!.slug,
        data.albums[0]!.global_album_uid ?? data.albums[0]!.global_uid,
      )
    : undefined;

  const playerTracks = useMemo<Track[]>(() => {
    if (!topTracks.length) return [];
    return topTracks.map((track) =>
      buildArtistPlayerTrack(track, data?.name || "", coverFallback),
    );
  }, [coverFallback, data?.name, topTracks]);

  async function handleArtistRadio() {
    const currentArtistSeed =
      data?.id ??
      routeGlobalArtistUid ??
      data?.global_artist_uid ??
      data?.global_uid;
    if (currentArtistSeed == null || !data?.name) return;
    try {
      const radio = await fetchArtistRadio(currentArtistSeed, data.name);
      if (!radio.tracks.length) {
        toast.info(t("artist.toasts.radioUnavailable"));
        return;
      }

      const queue: Track[] = radio.tracks.map((track) => ({
        ...track,
        albumCover: track.albumCover || coverFallback,
      }));

      playAll(queue, 0, radio.source);
    } catch {
      toast.error(t("artist.toasts.radioFailed"));
    }
  }

  function handlePlayTopTracks(startIndex = 0, shuffle = false) {
    if (!playerTracks.length) {
      toast.info(t("artist.toasts.noTopTracks"));
      return;
    }

    const queue = shuffle ? shuffleArray(playerTracks) : playerTracks;
    playAll(queue, shuffle ? 0 : startIndex, {
      type: "queue",
      name: t("artist.playSource.topTracks", {
        name: data?.name || t("artist.fallbackName"),
      }),
    });
  }

  const similarArtists = info?.similar ?? [];
  const appearsOn = pageData?.appears_on ?? [];
  const currentGlobalArtistUid =
    routeGlobalArtistUid ?? data?.global_artist_uid ?? data?.global_uid ?? null;
  const following = isFollowing(data?.id, currentGlobalArtistUid);
  const artistShowItems = buildArtistShowItems(showsData?.events ?? []);
  const albumsSorted = sortArtistAlbumsByYear(data?.albums ?? []);
  const previewTopTracks = topTracks.slice(0, 5);
  const visibleShowItems = [...artistShowItems]
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 5);
  const artistHotNow = pageData?.artist_hot_rank != null;

  async function handlePlayArtistSetlist() {
    try {
      if (!data?.id) return;
      const queue = await fetchPlayableSetlist({
        artistId: data.id,
        artistName: data.name,
      });
      if (!queue.length) {
        toast.info(t("artist.toasts.noSetlistMatches"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("artist.playSource.probableSetlist", { name: data.name }),
      });
      toast.success(t("artist.toasts.playingSetlist", { count: queue.length }));
    } catch {
      toast.error(t("artist.toasts.setlistFailed"));
    }
  }

  if (loading) {
    return <CrateLoader label={t("artist.loading")} />;
  }

  if (status === 404) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">{t("artist.notFound")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-muted-foreground">{t("artist.unavailable")}</p>
        <Button variant="outline" onClick={refetch}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">{t("artist.notFound")}</p>
      </div>
    );
  }

  const imageVersion = data.updated_at ?? undefined;
  const hasArtistPhoto = data.has_photo !== false;
  const photoUrl = hasArtistPhoto
    ? buildArtistPhotoUrl(data.name, data.id, data.slug, imageVersion)
    : "";
  const canonicalPhotoUrl = hasArtistPhoto
    ? artistPhotoApiUrl(
        {
          artistId: data.id,
          globalArtistUid: currentGlobalArtistUid,
          artistSlug: data.slug,
          artistName: data.name,
        },
        { size: 512, version: imageVersion },
      )
    : "";
  const backgroundUrl = artistBackgroundApiUrl(
    {
      artistId: data.id,
      globalArtistUid: currentGlobalArtistUid,
      artistSlug: data.slug,
      artistName: data.name,
    },
    { size: 1280, version: imageVersion },
  );
  const tags = data.genres.length > 0 ? data.genres : info?.tags ?? [];

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <ArtistHeroSection
        artist={data}
        artistInfo={info ?? undefined}
        photoUrl={canonicalPhotoUrl || photoUrl}
        backgroundUrl={backgroundUrl || undefined}
        tags={tags}
        following={following}
        onPlay={() => handlePlayTopTracks()}
        onShuffle={() => handlePlayTopTracks(0, true)}
        onArtistRadio={() => void handleArtistRadio()}
        onPlaySetlist={() => setSetlistModalOpen(true)}
        hasSetlist={!!enrichment?.setlist?.probable_setlist?.length}
        onToggleFollow={() => void toggleFollow()}
        onShare={() => void handleShare()}
        onOpenBio={() => setBioModalOpen(true)}
      />

      <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 pb-8 space-y-8">
        <ArtistTopTracksSection
          artistId={data.id}
          artistSlug={data.slug}
          tracks={previewTopTracks}
          coverFallback={coverFallback}
        />
        <ArtistAlbumsSection
          artistName={data.name}
          artistSlug={data.slug}
          albums={albumsSorted}
        />
        <ArtistAppearsOnSection playlists={appearsOn} />
        <ArtistShowsSection
          shows={visibleShowItems}
          expandedShowId={expandedShowId}
          artistHotNow={artistHotNow}
          onToggleExpand={setExpandedShowId}
          onPlayProbableSetlist={() => void handlePlayArtistSetlist()}
        />
        <RelatedArtistsSection artists={similarArtists} />
      </div>

      <ArtistBioModal
        open={bioModalOpen}
        artist={data}
        artistInfo={info ?? undefined}
        photoUrl={photoUrl}
        tags={tags}
        onClose={() => setBioModalOpen(false)}
      />
      {enrichment?.setlist?.probable_setlist?.length ? (
        <ArtistSetlistModal
          artistName={data.name}
          artistId={data.id}
          setlist={enrichment.setlist.probable_setlist}
          open={setlistModalOpen}
          onClose={() => setSetlistModalOpen(false)}
          onPlay={() => void handlePlayArtistSetlist()}
        />
      ) : null}
    </div>
  );
}
