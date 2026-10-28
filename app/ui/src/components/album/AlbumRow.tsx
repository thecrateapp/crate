import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Link } from "react-router";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";

import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
} from "@/lib/library-routes";

interface AlbumRowProps {
  artist: string;
  artistId?: number;
  artistSlug?: string;
  album: string;
  albumId?: number;
  albumSlug?: string;
  year?: string;
  tracks?: number;
  format?: string;
  duration?: number;
  size_mb?: number;
  showArtist?: boolean;
  actions?: React.ReactNode;
  coverUrl?: string;
  placeholder?: boolean;
}

export function AlbumRow({
  artist,
  artistId,
  artistSlug,
  album,
  albumId,
  albumSlug,
  year,
  tracks,
  format,
  size_mb,
  showArtist = true,
  actions,
  coverUrl,
  placeholder,
}: AlbumRowProps) {
  const src =
    coverUrl ??
    albumCoverApiUrl({
      albumId,
      albumSlug,
      artistName: artist,
      albumName: album,
    });
  return (
    <EntityRow
      title={album}
      href={albumPagePath({
        albumId,
        albumSlug,
        artistName: artist,
        albumName: album,
      })}
      menuButton="none"
      cover={{ src: placeholder ? null : src, alt: album }}
      subtitle={[year, tracks !== undefined ? `${tracks} tracks` : null]
        .filter(Boolean)
        .join(" · ")}
      trailing={
        <>
          {showArtist ? (
            <Link
              className="text-sm text-text-muted hover:text-accent-action-hi"
              to={artistPagePath({ artistId, artistSlug, artistName: artist })}
            >
              {artist}
            </Link>
          ) : null}
          {format ? (
            <InfoBadge>{format.replace(".", "").toUpperCase()}</InfoBadge>
          ) : null}
          {size_mb !== undefined ? (
            <span className="font-mono text-label text-text-subtle">
              {size_mb} MB
            </span>
          ) : null}
          {actions}
        </>
      }
    />
  );
}
