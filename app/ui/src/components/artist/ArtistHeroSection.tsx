import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { NextShowBadge } from "@/components/shows/NextShowBadge";
import { Link } from "react-router";

import { ImageCropUpload } from "@/components/ImageCropUpload";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@/components/genres/GenrePill";
import { PageHero } from "@crate/ui/domain/hero";
import { ArtistHeroFrame } from "@crate/ui/domain/ArtistHeroFrame";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  AlignLeft,
  Archive,
  AudioLines,
  Link as LinkIcon,
  ListMusic,
  Pencil,
  RefreshCw,
  Toolbox,
  Tag,
  Trash2,
} from "@crate/ui/icons";
import {
  artistArtworkApiPath,
  artistBackgroundApiUrl,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { formatCompact, formatNumber, formatSize } from "@/lib/utils";

import type { ArtistShowEvent } from "./ArtistShowsSection";

interface ArtistHeroMusicBrainz {
  type?: string;
  begin_date?: string;
  country?: string;
  area?: string;
}

interface ArtistHeroSectionProps {
  artistName: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  imageVersion?: string | null;
  letter: string;
  albumCount: number;
  totalTracks: number;
  totalSizeMb: number;
  issueCount?: number;
  showRepairAction?: boolean;
  musicbrainz?: ArtistHeroMusicBrainz;
  lastfmListeners?: number;
  upcomingShow?: ArtistShowEvent;
  popularityScore: number;
  genreProfile?: GenreProfileItem[];
  tags: string[];
  enriching: boolean;
  isAdmin: boolean;
  canEditArtwork?: boolean;
  canEnrich?: boolean;
  canAnalyze?: boolean;
  canEditMetadata?: boolean;
  canCreateCorePlaylist?: boolean;
  canQueueMetadata?: boolean;
  canRepair?: boolean;
  canDelete?: boolean;
  canMerge?: boolean;
  photoLoaded: boolean;
  photoError: boolean;
  photoCacheBust: string;
  bgCacheBust: string;
  bgLoaded: boolean;
  onBackgroundLoad: () => void;
  onPhotoLoad: () => void;
  onPhotoError: () => void;
  onBackgroundUploaded: () => void;
  onPhotoUploaded: () => void;
  onEnrich: () => void;
  onAnalyze: () => void;
  onEditMetadata?: () => void;
  onRepair: () => void;
  metadataAction?: "lyrics" | "portable" | "export" | null;
  corePlaylistCreating?: boolean;
  onCreateCorePlaylist?: () => void;
  onSyncLyrics?: () => void;
  onWritePortableMetadata?: () => void;
  onExportRichMetadata?: () => void;
  onMerge?: () => void;
  onDelete: () => void;
}

export function ArtistHeroSection({
  artistName,
  artistId,
  artistEntityUid,
  artistSlug,
  imageVersion,
  letter,
  albumCount,
  totalTracks,
  totalSizeMb,
  issueCount,
  showRepairAction,
  musicbrainz,
  lastfmListeners,
  upcomingShow,
  popularityScore,
  genreProfile,
  tags,
  enriching,
  isAdmin,
  canEditArtwork = isAdmin,
  canEnrich = isAdmin,
  canAnalyze = isAdmin,
  canEditMetadata = isAdmin,
  canCreateCorePlaylist = isAdmin,
  canQueueMetadata = isAdmin,
  canRepair = isAdmin,
  canDelete = isAdmin,
  canMerge = isAdmin,
  photoLoaded,
  photoError,
  photoCacheBust,
  bgCacheBust,
  bgLoaded,
  onBackgroundLoad,
  onPhotoLoad,
  onPhotoError,
  onBackgroundUploaded,
  onPhotoUploaded,
  onEnrich,
  onAnalyze,
  onEditMetadata,
  onRepair,
  metadataAction = null,
  corePlaylistCreating = false,
  onCreateCorePlaylist,
  onSyncLyrics,
  onWritePortableMetadata,
  onExportRichMetadata,
  onMerge,
  onDelete,
}: ArtistHeroSectionProps) {
  const backgroundUrl = artistBackgroundApiUrl(
    { artistId, artistEntityUid, artistSlug, artistName },
    { version: imageVersion },
  );
  const photoUrl = artistPhotoApiUrl(
    { artistId, artistEntityUid, artistSlug, artistName },
    { version: imageVersion },
  );
  const backgroundSrc = `${backgroundUrl}?v=stable-hero-bg-v2${
    bgCacheBust ? `&t=${bgCacheBust}` : ""
  }`;
  const photoSrc = `${photoUrl}?v=stable-hero-photo${
    photoCacheBust ? `&t=${photoCacheBust}` : ""
  }`;

  const actions = (
    <ActionGroup label="Artist actions">
      {canEnrich ? (
        <ActionButton
          label={enriching ? "Enriching artist" : "Enrich"}
          loading={enriching}
          onClick={onEnrich}
        >
          <RefreshCw data-admin-ux="artist-enrich" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canAnalyze ? (
        <ActionButton label="Analyze" onClick={onAnalyze}>
          <AudioLines data-admin-ux="artist-analyze" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canEditMetadata && onEditMetadata ? (
        <ActionButton label="Edit" onClick={onEditMetadata}>
          <Pencil data-admin-ux="artist-edit" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canCreateCorePlaylist && onCreateCorePlaylist ? (
        <ActionButton
          label="Core Tracks"
          onClick={onCreateCorePlaylist}
          loading={corePlaylistCreating}
        >
          <ListMusic data-admin-ux="artist-core-playlist" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canQueueMetadata && onSyncLyrics ? (
        <ActionButton
          label="Lyrics"
          onClick={onSyncLyrics}
          disabled={metadataAction !== null}
          loading={metadataAction === "lyrics"}
        >
          <AlignLeft data-admin-ux="artist-sync-lyrics" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canQueueMetadata && onWritePortableMetadata ? (
        <ActionButton
          label="Metadata"
          onClick={onWritePortableMetadata}
          disabled={metadataAction !== null}
          loading={metadataAction === "portable"}
        >
          <Tag data-admin-ux="artist-write-metadata" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canQueueMetadata && onExportRichMetadata ? (
        <ActionButton
          label="Export"
          onClick={onExportRichMetadata}
          disabled={metadataAction !== null}
          loading={metadataAction === "export"}
        >
          <Archive data-admin-ux="artist-export-metadata" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canRepair && showRepairAction ? (
        <ActionButton
          label={(issueCount ?? 0) > 0 ? `Repair (${issueCount})` : "Repair"}
          onClick={onRepair}
        >
          <Toolbox data-admin-ux="artist-repair" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canMerge && onMerge ? (
        <ActionButton label="Merge Alias" onClick={onMerge}>
          <LinkIcon data-admin-ux="artist-merge" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canDelete ? (
        <ActionButton label="Delete" onClick={onDelete}>
          <Trash2 data-admin-ux="artist-delete" aria-hidden="true" />
        </ActionButton>
      ) : null}
    </ActionGroup>
  );

  return (
    <div className="group/hero relative min-w-0">
      <PageHero
        variant="artist"
        title={artistName}
        inset="none"
        artworkClassName="overflow-visible"
        eyebrow={
          <Link to="/browse">
            <MonoLabel as="span">Browse</MonoLabel>
          </Link>
        }
        background={{
          overlay: <></>,
          render: () => (
            <>
              <div className="h-full sm:hidden">
                <ArtistHeroFrame
                  composition="mobile"
                  aspectRatio="auto"
                  className="h-full"
                  artwork={
                    <img
                      src={photoError ? backgroundSrc : photoSrc}
                      alt=""
                      className={`absolute inset-0 size-full object-cover object-[right_20%] brightness-[0.72] contrast-110 transition-opacity duration-300 ${(photoError ? bgLoaded : photoLoaded) ? "opacity-80" : "opacity-0"}`}
                      onLoad={photoError ? onBackgroundLoad : onPhotoLoad}
                      onError={photoError ? undefined : onPhotoError}
                    />
                  }
                />
              </div>
              <div className="hidden h-full sm:block">
                <ArtistHeroFrame
                  composition="desktop"
                  aspectRatio="auto"
                  className="h-full"
                  artwork={
                    <img
                      key={bgCacheBust || "bg"}
                      src={backgroundSrc}
                      alt=""
                      className={`absolute inset-0 size-full object-cover object-[right_20%] grayscale brightness-[0.5] contrast-110 transition-opacity duration-500 ${bgLoaded ? "opacity-45" : "opacity-0"}`}
                      onLoad={onBackgroundLoad}
                    />
                  }
                />
              </div>
            </>
          ),
        }}
        artwork={
          <div className="group/cover relative size-full rounded-full bg-surface-object">
            {!photoError ? (
              <img
                key={photoCacheBust || "photo"}
                src={photoSrc}
                alt={artistName}
                className={`size-full rounded-full object-cover transition-opacity duration-300 ${photoLoaded ? "opacity-100" : "opacity-0"}`}
                onLoad={onPhotoLoad}
                onError={onPhotoError}
              />
            ) : null}
            {photoError || !photoLoaded ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-full font-display text-5xl text-text-muted">
                {letter}
              </span>
            ) : null}
            {canEditArtwork ? (
              <ImageCropUpload
                endpoint={artistArtworkApiPath(
                  { artistId, artistEntityUid },
                  "upload-photo",
                )}
                aspect={1}
                onUploaded={onPhotoUploaded}
                label="Edit photo"
              />
            ) : null}
          </div>
        }
        subtitle={
          musicbrainz?.area ||
          musicbrainz?.country ||
          musicbrainz?.begin_date ||
          musicbrainz?.type ? (
            <>
              {musicbrainz.area || musicbrainz.country ? (
                <MonoLabel as="span">
                  {[musicbrainz.area, musicbrainz.country]
                    .filter(Boolean)
                    .join(", ")}
                </MonoLabel>
              ) : null}
              {musicbrainz.begin_date ? (
                <MonoLabel as="span">Est. {musicbrainz.begin_date}</MonoLabel>
              ) : null}
              {musicbrainz.type ? (
                <MonoLabel as="span">{musicbrainz.type}</MonoLabel>
              ) : null}
            </>
          ) : undefined
        }
        meta={[
          <MonoLabel as="span" key="albums">
            {albumCount} albums
          </MonoLabel>,
          <MonoLabel as="span" key="tracks">
            {formatNumber(totalTracks)} tracks
          </MonoLabel>,
          <MonoLabel as="span" key="size">
            {formatSize(totalSizeMb)}
          </MonoLabel>,
          (lastfmListeners ?? 0) > 0 ? (
            <MonoLabel as="span" key="listeners">
              {formatCompact(lastfmListeners!)} listeners
            </MonoLabel>
          ) : null,
          (issueCount ?? 0) > 0 ? (
            <InfoBadge key="issues" tone="warning">
              {issueCount} issues
            </InfoBadge>
          ) : null,
        ]}
        actions={actions}
      >
        {popularityScore > 0 ? (
          <MonoLabel as="p" className="mt-3">
            Popularity {popularityScore}%
          </MonoLabel>
        ) : null}
        {upcomingShow ? (
          <NextShowBadge show={upcomingShow} className="mt-3" />
        ) : null}
        {genreProfile && genreProfile.length > 0 ? (
          <GenrePillRow items={genreProfile} max={6} className="mt-3" />
        ) : tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.slice(0, 8).map((tag) => (
              <InfoBadge key={tag}>{tag.toLowerCase()}</InfoBadge>
            ))}
          </div>
        ) : null}
      </PageHero>
      {canEditArtwork ? (
        <>
          <ImageCropUpload
            endpoint={artistArtworkApiPath(
              { artistId, artistEntityUid },
              "upload-photo",
            )}
            aspect={1}
            onUploaded={onPhotoUploaded}
            label="Edit photo"
            className="absolute right-14 top-2 z-20 inline-flex sm:hidden"
          />
          <ImageCropUpload
            endpoint={artistArtworkApiPath(
              { artistId, artistEntityUid },
              "upload-background",
            )}
            aspect={21 / 9}
            onUploaded={onBackgroundUploaded}
            label="Edit background"
            className="absolute right-2 top-2 z-20 inline-flex"
          />
        </>
      ) : null}
    </div>
  );
}
