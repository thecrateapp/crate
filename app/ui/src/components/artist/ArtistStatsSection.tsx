import type { ArtistData } from "./artistPageTypes";
import { ArtistDetailSection } from "./ArtistDetailSection";
import { ArtistStats } from "@/components/artist/ArtistStats";

interface ArtistStatsSectionProps {
  artistName: string;
  artistId?: number;
  artistEntityUid?: string;
  catalogueAlbums?: ArtistData["albums"];
  totalTracks?: number;
  genreProfile?: ArtistData["genre_profile"];
}

export function ArtistStatsSection({
  artistId,
  artistEntityUid,
  catalogueAlbums,
  totalTracks,
  genreProfile,
}: ArtistStatsSectionProps) {
  return (
    <ArtistDetailSection title="Stats">
      <ArtistStats
        artistId={artistId}
        artistEntityUid={artistEntityUid}
        catalogueAlbums={catalogueAlbums}
        totalTracks={totalTracks}
        genreProfile={genreProfile}
      />
    </ArtistDetailSection>
  );
}
