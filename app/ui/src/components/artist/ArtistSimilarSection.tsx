import { ArtistDetailSection } from "./ArtistDetailSection";
import { ArtistNetworkGraph } from "@/components/artist/ArtistNetworkGraph";
import { SimilarArtistCard } from "@/components/artist/ArtistPageBits";

interface SimilarArtist {
  id?: number;
  slug?: string;
  name: string;
  image?: string;
  genres?: string[];
  popularity?: number;
}

interface ArtistSimilarSectionProps {
  artistName: string;
  artistId?: number;
  artistEntityUid?: string;
  artists: SimilarArtist[];
}

export function ArtistSimilarSection({
  artistName,
  artistId,
  artistEntityUid,
  artists,
}: ArtistSimilarSectionProps) {
  return (
    <div>
      <ArtistDetailSection title="Artist Network" className="mb-8">
        <ArtistNetworkGraph
          centerArtist={artistName}
          centerArtistId={artistId}
          centerArtistEntityUid={artistEntityUid}
        />
      </ArtistDetailSection>
      {artists.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
          {artists.map((artist) => (
            <SimilarArtistCard
              key={artist.name}
              id={artist.id}
              slug={artist.slug}
              name={artist.name}
              image={artist.image}
              genres={artist.genres}
              popularity={artist.popularity}
            />
          ))}
        </div>
      )}
    </div>
  );
}
