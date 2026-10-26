import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { useState } from "react";
import { Link } from "react-router";
import { Bot, Download, AlignLeft, Save, Share2 } from "@crate/ui/icons";
import { PageHero } from "@crate/ui/domain/hero";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import {
  ActionButton,
  ActionGroup,
  ActionLink,
} from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { toast } from "sonner";

import { ImageLightbox } from "@crate/ui/primitives/ImageLightbox";

import {
  GenrePillRow,
  type GenreProfileItem,
} from "@/components/genres/GenrePill";
import { ImageCropUpload } from "@/components/ImageCropUpload";
import { api } from "@/lib/api";
import {
  albumActionApiPath,
  albumArtworkApiPath,
  albumCoverApiUrl,
  artistBackgroundApiUrl,
  artistPagePath,
} from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { formatDuration, formatSize } from "@/lib/utils";

type AlbumMetadataAction = "lyrics" | "portable" | "export" | null;

interface AlbumHeaderProps {
  albumId?: number;
  albumEntityUid?: string;
  albumSlug?: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  artist: string;
  album: string;
  displayName?: string;
  albumTags: {
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    musicbrainz_albumid?: string | null;
  };
  trackCount: number;
  totalLengthSec: number;
  totalSizeMb: number;
  hasCover: boolean;
  popularity?: number | null;
  popularityScore?: number | null;
  popularityConfidence?: number | null;
  genres?: string[];
  genreProfile?: GenreProfileItem[];
  onGenreSelect?: (genre: GenreProfileItem) => void;
  hasAnalysis?: boolean;
  onAnalysisComplete?: () => void;
  onMetadataTaskQueued?: (
    action: Exclude<AlbumMetadataAction, null>,
    taskId: string,
  ) => void;
  isAdmin?: boolean;
  canDownload?: boolean;
  canEditArtwork?: boolean;
  canEnrich?: boolean;
  canQueueMetadata?: boolean;
  children?: React.ReactNode;
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  try {
    const parsed = JSON.parse(error.message) as {
      detail?: unknown;
      error?: unknown;
    };
    const detail = parsed.detail ?? parsed.error;
    if (typeof detail === "string" && detail.trim()) return detail;
  } catch {
    // Use the original message below.
  }
  return error.message;
}

export function AlbumHeader({
  albumId,
  albumEntityUid,
  albumSlug,
  artistId,
  artistEntityUid,
  artistSlug,
  artist,
  album,
  displayName: explicitDisplayName,
  albumTags,
  trackCount,
  totalLengthSec,
  totalSizeMb,
  hasCover,
  popularity,
  popularityScore,
  genreProfile,
  genres,
  onGenreSelect,
  onAnalysisComplete,
  onMetadataTaskQueued,
  isAdmin = false,
  canDownload = true,
  canEditArtwork = isAdmin,
  canEnrich = isAdmin,
  canQueueMetadata = isAdmin,
  children,
}: AlbumHeaderProps) {
  const [coverCacheBust, setCoverCacheBust] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [metadataAction, setMetadataAction] =
    useState<AlbumMetadataAction>(null);

  const baseCoverUrl = albumCoverApiUrl({
    albumId,
    albumEntityUid,
    albumSlug,
    artistName: artist,
    albumName: album,
  });
  const coverUrl = `${baseCoverUrl}${
    coverCacheBust
      ? `${baseCoverUrl.includes("?") ? "&" : "?"}t=${coverCacheBust}`
      : ""
  }`;
  const bgUrl = artistBackgroundApiUrl({
    artistId,
    artistEntityUid,
    artistSlug,
    artistName: artist,
  });
  const resolvedDisplayName = albumTags.album || explicitDisplayName || album;
  const displayArtist = albumTags.artist || artist;
  const popularityPercent =
    popularityScore != null
      ? Math.round(popularityScore * 100)
      : typeof popularity === "number" && popularity > 0
        ? popularity
        : 0;

  async function handleEnrich() {
    if (albumId == null && !albumEntityUid) {
      toast.error("Album reference missing");
      return;
    }
    setAnalyzing(true);
    try {
      const endpoint = albumActionApiPath(
        { albumId, albumEntityUid },
        "enrich",
      );
      if (!endpoint) throw new Error("album reference missing");
      const response = await api<{ task_id: string }>(endpoint, "POST");
      toast.success("Enriching album...");
      const task = await waitForTask(response.task_id, 120000);
      setAnalyzing(false);
      if (task.status === "completed") {
        toast.success("Album enrichment complete");
        onAnalysisComplete?.();
      } else if (task.status === "failed") {
        toast.error("Enrichment failed");
      }
    } catch {
      setAnalyzing(false);
      toast.error("Failed to start enrichment");
    }
  }

  async function queueAlbumMetadataAction(
    action: Exclude<AlbumMetadataAction, null>,
  ) {
    if (albumId == null && !albumEntityUid) {
      toast.error("Album reference missing");
      return;
    }

    const albumReference = {
      album_id: albumId,
      album_entity_uid: albumEntityUid,
    };

    setMetadataAction(action);
    try {
      if (action === "lyrics") {
        const response = await api<{ task_id: string }>(
          "/api/manage/sync-lyrics",
          "POST",
          { ...albumReference, limit: 500 },
        );
        onMetadataTaskQueued?.(action, response.task_id);
        toast.success("Lyrics sync queued");
      } else if (action === "portable") {
        const response = await api<{ task_id: string }>(
          "/api/manage/portable-metadata",
          "POST",
          {
            ...albumReference,
            write_audio_tags: true,
            write_sidecars: true,
            limit: 1,
          },
        );
        onMetadataTaskQueued?.(action, response.task_id);
        toast.success("Portable metadata queued");
      } else {
        const response = await api<{ task_id: string }>(
          "/api/manage/portable-metadata/export-rich",
          "POST",
          {
            ...albumReference,
            include_audio: false,
            write_rich_tags: false,
            limit: 1,
          },
        );
        onMetadataTaskQueued?.(action, response.task_id);
        toast.success("Rich metadata export queued");
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to queue metadata task"));
    } finally {
      setMetadataAction(null);
    }
  }

  return (
    <div className="space-y-4">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        <Link to="/browse">
          <MonoLabel as="span">Browse</MonoLabel>
        </Link>
        <span aria-hidden="true" className="text-text-subtle">
          /
        </span>
        <Link to={artistPagePath({ artistId, artistSlug, artistName: artist })}>
          <MonoLabel as="span">{artist}</MonoLabel>
        </Link>
      </nav>
      <PageHero
        variant="media"
        title={resolvedDisplayName}
        height="content"
        className="min-h-hero-md"
        contentClassName="mx-0 max-w-none px-0 sm:px-0"
        actionsClassName="px-0 sm:px-0"
        background={{ src: bgUrl }}
        artworkClassName="block size-36 sm:size-48 lg:size-56"
        artwork={
          <div className="group/cover relative size-full">
            <ImageLightbox
              src={coverUrl}
              alt={`${resolvedDisplayName} cover art`}
            >
              <MediaCover
                key={coverUrl}
                src={coverUrl}
                alt={resolvedDisplayName}
                size="fill"
              />
            </ImageLightbox>
            {canEditArtwork ? (
              <ImageCropUpload
                endpoint={albumArtworkApiPath(
                  { albumId, albumEntityUid },
                  "upload-cover",
                )}
                aspect={1}
                onUploaded={() => setCoverCacheBust(String(Date.now()))}
                className="absolute bottom-2 right-2 z-20"
              />
            ) : null}
          </div>
        }
        subtitle={
          <Link
            className="hover:text-accent-action-hi"
            to={artistPagePath({ artistId, artistSlug, artistName: artist })}
          >
            {displayArtist}
          </Link>
        }
        meta={[
          albumTags.year ? (
            <MonoLabel as="span" key="year">
              {albumTags.year}
            </MonoLabel>
          ) : null,
          <MonoLabel as="span" key="tracks">
            {trackCount} tracks
          </MonoLabel>,
          <MonoLabel as="span" key="duration">
            {formatDuration(totalLengthSec)}
          </MonoLabel>,
          <MonoLabel as="span" key="size">
            {formatSize(totalSizeMb)}
          </MonoLabel>,
          popularityPercent > 0 ? (
            <MonoLabel as="span" key="popularity">
              Popularity {popularityPercent}%
            </MonoLabel>
          ) : null,
        ]}
        metaSeparator="dot"
        actions={
          <ActionGroup label="Album actions">
            {canEnrich ? (
              <ActionButton
                label="Enrich"
                onClick={handleEnrich}
                loading={analyzing}
              >
                <Bot data-admin-ux="album-enrich" aria-hidden="true" />
              </ActionButton>
            ) : null}
            {canDownload ? (
              <ActionLink
                label="Download"
                href={
                  albumActionApiPath({ albumId, albumEntityUid }, "download") ||
                  undefined
                }
                download
              >
                <Download data-admin-ux="album-download" aria-hidden="true" />
              </ActionLink>
            ) : null}
            {canQueueMetadata ? (
              <>
                <ActionButton
                  label="Lyrics"
                  tooltip="Sync album lyrics"
                  onClick={() => void queueAlbumMetadataAction("lyrics")}
                  loading={metadataAction === "lyrics"}
                  disabled={metadataAction !== null}
                >
                  <AlignLeft
                    data-admin-ux="album-sync-lyrics"
                    aria-hidden="true"
                  />
                </ActionButton>
                <ActionButton
                  label="Metadata"
                  tooltip="Write portable album metadata"
                  onClick={() => void queueAlbumMetadataAction("portable")}
                  loading={metadataAction === "portable"}
                  disabled={metadataAction !== null}
                >
                  <Save
                    data-admin-ux="album-write-metadata"
                    aria-hidden="true"
                  />
                </ActionButton>
                <ActionButton
                  label="Export"
                  tooltip="Export rich album metadata"
                  onClick={() => void queueAlbumMetadataAction("export")}
                  loading={metadataAction === "export"}
                  disabled={metadataAction !== null}
                >
                  <Share2
                    data-admin-ux="album-export-metadata"
                    aria-hidden="true"
                  />
                </ActionButton>
              </>
            ) : null}
            {children}
          </ActionGroup>
        }
      >
        {genreProfile?.length || genres?.length ? (
          <GenrePillRow
            items={
              genreProfile?.length
                ? genreProfile
                : (genres ?? []).map((name) => ({ name }))
            }
            max={8}
            className="mt-4"
            onSelect={onGenreSelect}
          />
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <InfoBadge tone={hasCover ? "neutral" : "warning"}>
            {hasCover ? "Cover" : "No cover"}
          </InfoBadge>
          {albumTags.musicbrainz_albumid ? (
            <a
              href={`https://musicbrainz.org/release/${albumTags.musicbrainz_albumid}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <InfoBadge title="View on MusicBrainz">
                MBID {albumTags.musicbrainz_albumid.slice(0, 8)}
              </InfoBadge>
            </a>
          ) : (
            <InfoBadge tone="warning">No MBID</InfoBadge>
          )}
        </div>
      </PageHero>
    </div>
  );
}
