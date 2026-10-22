import type { ReactNode } from "react";
import { useParams } from "react-router";

interface ArtistAlbumRouteProps {
  artist: ReactNode;
  album: ReactNode;
}

/**
 * The two-segment artist/album URL and the old artist-ID URL have the same
 * route shape. Resolve them by the first segment instead of declaring two
 * equally ranked React Router routes and relying on their order.
 */
export function ArtistAlbumRoute({ artist, album }: ArtistAlbumRouteProps) {
  const { artistSlug } = useParams<{ artistSlug: string }>();
  return artistSlug && /^\d+$/.test(artistSlug) ? artist : album;
}
