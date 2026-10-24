import { useState } from "react";
import { EntityCard } from "@crate/ui/domain/entity";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { formatSize } from "@/lib/utils";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface ArtistCardProps {
  name: string;
  artistId?: number;
  artistSlug?: string;
  albums: number;
  tracks: number;
  size_mb: number;
  primary_format: string;
  hasIssues?: boolean;
  isFeatured?: boolean;
  featuredDevices?: string[];
  selectMode?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  /** Browse preserves square artist covers; artist entity views default to portraits. */
  artworkShape?: "circle" | "square";
}

export function ArtistCard({
  name,
  artistId,
  artistSlug,
  albums,
  tracks,
  size_mb,
  primary_format,
  hasIssues,
  isFeatured,
  featuredDevices = [],
  selectMode,
  isSelected,
  onClick,
  artworkShape = "circle",
}: ArtistCardProps) {
  const [imgError, setImgError] = useState(false);
  return (
    <EntityCard
      title={name}
      layout="grid"
      shape={artworkShape}
      profileSize="tile"
      fillGrid
      selected={isSelected}
      pressed={selectMode ? Boolean(isSelected) : undefined}
      href={
        !selectMode && !onClick
          ? artistPagePath({ artistId, artistSlug, artistName: name })
          : undefined
      }
      onOpen={onClick}
      openLabel={
        selectMode
          ? `${isSelected ? "Deselect" : "Select"} ${name}`
          : `Open ${name}`
      }
      menuButton="none"
      artwork={
        !imgError ? (
          <img
            src={artistPhotoApiUrl({ artistId, artistSlug, artistName: name })}
            alt={name}
            loading="lazy"
            className="size-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-surface-object font-display text-4xl text-text-muted">
            {name.charAt(0).toUpperCase()}
          </span>
        )
      }
      artworkOverlay={
        hasIssues ? (
          <span className="absolute inset-x-0 bottom-0 bg-surface-canvas/90 p-2 text-center">
            <MonoLabel as="span" className="text-state-warning-text">
              Needs repair
            </MonoLabel>
          </span>
        ) : undefined
      }
      subtitle={
        <MonoLabel as="span">
          {albums} {albums === 1 ? "album" : "albums"} · {tracks} tracks
        </MonoLabel>
      }
      meta={
        <span className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          {isFeatured ? <InfoBadge active>Featured</InfoBadge> : null}
          {isFeatured
            ? featuredDevices.map((device) => (
                <InfoBadge key={device}>{device}</InfoBadge>
              ))
            : null}
          {primary_format ? (
            <InfoBadge>
              {primary_format.replace(".", "").toUpperCase()}
            </InfoBadge>
          ) : null}
          <InfoBadge>{formatSize(size_mb)}</InfoBadge>
        </span>
      }
    />
  );
}
