import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import React, { useState } from "react";
import { ImagePlus, Loader2 } from "@crate/ui/icons";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { toast } from "sonner";

import { ActionButton } from "@crate/ui/primitives/ActionGroup";

import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { api } from "@/lib/api";
import {
  albumActionApiPath,
  albumCoverApiUrl,
  albumPagePath,
} from "@/lib/library-routes";

interface AlbumCardProps {
  albumId?: number;
  albumEntityUid?: string;
  albumSlug?: string;
  artist: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  name: string;
  displayName?: string;
  year?: string;
  tracks: number;
  formats: string[];
  bitDepth?: number | null;
  sampleRate?: number | null;
  hasCover?: boolean;
}

function qualityLabel(
  formats: string[],
  bitDepth?: number | null,
  sampleRate?: number | null,
): { label: string; tier: "hi-res" | "lossless" | "lossy" } | null {
  if (!formats.length) return null;
  const fmt = (formats[0] ?? "").replace(".", "").toLowerCase();
  const fmtUp = fmt.toUpperCase();
  const isLossless = ["flac", "alac", "wav", "aiff"].includes(fmt);
  const depth = bitDepth || 16;
  const rateKhz = sampleRate ? sampleRate / 1000 : 44.1;
  const rateStr = `${rateKhz % 1 ? rateKhz.toFixed(1) : rateKhz}kHz`;

  if (isLossless && (depth > 16 || rateKhz > 48)) {
    return { label: `${fmtUp} ${depth}/${rateStr}`, tier: "hi-res" };
  }
  if (isLossless) {
    return { label: `${fmtUp} ${depth}/${rateStr}`, tier: "lossless" };
  }
  return { label: fmtUp, tier: "lossy" };
}

export const AlbumCard = React.memo(function AlbumCard({
  albumId,
  albumEntityUid,
  albumSlug,
  artist,
  artistId,
  artistEntityUid,
  artistSlug,
  name,
  displayName,
  year,
  tracks,
  formats,
  bitDepth,
  sampleRate,
}: AlbumCardProps) {
  const [imgError, setImgError] = useState(false);
  const [coverRevision, setCoverRevision] = useState(0);
  const [fetchingCover, setFetchingCover] = useState(false);
  const coverUrl = albumCoverApiUrl({
    albumId,
    albumEntityUid,
    albumSlug,
    artistSlug,
    artistName: artist,
    albumName: name,
  });

  async function handleFetchCover(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!albumId || fetchingCover) return;
    setFetchingCover(true);
    try {
      await api(
        albumActionApiPath({ albumId, albumEntityUid }, "fetch-cover"),
        "POST",
      );
      toast.success("Searching for cover...");
      await new Promise((resolve) => window.setTimeout(resolve, 8000));
      setCoverRevision(Date.now());
      setImgError(false);
    } catch {
      toast.error("Failed to search for cover");
    } finally {
      setFetchingCover(false);
    }
  }

  return (
    <MusicContextMenu
      type="album"
      artist={artist}
      artistId={artistId}
      artistEntityUid={artistEntityUid}
      artistSlug={artistSlug}
      album={name}
      albumId={albumId}
      albumEntityUid={albumEntityUid}
      albumSlug={albumSlug}
    >
      <div className="group relative min-w-0">
        <EntityCard
          title={displayName || name}
          href={albumPagePath({
            albumId,
            albumSlug,
            artistSlug,
            artistName: artist,
            albumName: name,
          })}
          layout="grid"
          menuButton="none"
          disableItemActionTarget
          cover={{
            src: imgError
              ? null
              : `${coverUrl}${coverRevision ? `${coverUrl.includes("?") ? "&" : "?"}t=${coverRevision}` : ""}`,
            alt: name,
            renderImage: (image) => (
              <img
                src={image.src}
                alt={image.alt}
                className={image.className}
                loading="lazy"
                onError={() => {
                  image.onError();
                  setImgError(true);
                }}
              />
            ),
          }}
          subtitle={year ? `${year} · ${artist}` : artist}
          meta={
            <span className="flex flex-wrap items-center gap-2">
              <span>{tracks} tracks</span>
              {qualityLabel(formats, bitDepth, sampleRate) ? (
                <InfoBadge
                  tone={
                    qualityLabel(formats, bitDepth, sampleRate)?.tier ===
                    "lossy"
                      ? "neutral"
                      : "accent"
                  }
                >
                  {qualityLabel(formats, bitDepth, sampleRate)?.label}
                </InfoBadge>
              ) : null}
            </span>
          }
        />
        {imgError && albumId ? (
          <div className="absolute right-3 top-3 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
            <ActionButton
              onClick={handleFetchCover}
              loading={fetchingCover}
              label="Search for cover"
            >
              {fetchingCover ? (
                <Loader2
                  data-admin-ux="album-cover-loading"
                  aria-hidden="true"
                  className="animate-spin"
                />
              ) : (
                <ImagePlus
                  data-admin-ux="album-cover-search"
                  aria-hidden="true"
                />
              )}
            </ActionButton>
          </div>
        ) : null}
      </div>
    </MusicContextMenu>
  );
});
