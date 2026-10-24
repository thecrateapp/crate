import { useState } from "react";
import { EntityRow } from "@crate/ui/domain/entity";
import { GenrePillRow } from "@crate/ui/domain/genres/GenrePill";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { formatCompact, formatSize } from "@/lib/utils";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface ArtistRowProps {
  name: string;
  artistId?: number;
  artistSlug?: string;
  albums: number;
  tracks: number;
  total_size_mb: number;
  listeners?: number;
  genres?: string[];
  primary_format?: string;
  hasIssues?: boolean;
  isFeatured?: boolean;
  featuredDevices?: string[];
  selectMode?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  /** Browse preserves square artist covers; artist entity views default to portraits. */
  artworkShape?: "circle" | "square";
}

export function ArtistRow({
  name,
  artistId,
  artistSlug,
  albums,
  tracks,
  total_size_mb,
  listeners,
  genres,
  hasIssues,
  isFeatured,
  featuredDevices = [],
  selectMode,
  isSelected,
  onClick,
  artworkShape = "circle",
}: ArtistRowProps) {
  const [imgError, setImgError] = useState(false);
  return (
    <EntityRow
      title={name}
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
      shape={artworkShape}
      leading={
        <span
          data-shape={artworkShape}
          className={`crate-media-thumbnail relative flex size-12 shrink-0 items-center justify-center overflow-hidden bg-surface-object ${artworkShape === "square" ? "rounded-lg" : "rounded-full"}`}
        >
          {!imgError ? (
            <img
              src={artistPhotoApiUrl({
                artistId,
                artistSlug,
                artistName: name,
              })}
              alt={name}
              loading="lazy"
              className="size-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="font-display text-base text-text-muted">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
      }
      subtitle={
        genres?.length ? (
          <GenrePillRow
            items={genres.slice(0, 3).map((genre) => ({ name: genre }))}
          />
        ) : undefined
      }
      titleAccessory={
        <>
          {isFeatured ? <InfoBadge active>Featured</InfoBadge> : null}
          {hasIssues ? (
            <InfoBadge tone="warning">Needs repair</InfoBadge>
          ) : null}
          {isFeatured
            ? featuredDevices.map((device) => (
                <InfoBadge key={device}>{device}</InfoBadge>
              ))
            : null}
        </>
      }
      trailing={
        <>
          <MonoLabel as="span" className="hidden sm:block">
            {albums} albums · {tracks} tracks
          </MonoLabel>
          <MonoLabel as="span" className="hidden lg:block">
            {formatSize(total_size_mb)}
          </MonoLabel>
          {listeners != null && listeners > 0 ? (
            <MonoLabel as="span" className="hidden md:block">
              {formatCompact(listeners)} listeners
            </MonoLabel>
          ) : null}
        </>
      }
    />
  );
}
