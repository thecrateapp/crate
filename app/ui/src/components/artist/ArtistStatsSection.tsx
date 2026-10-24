import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { ArtistNetworkGraph } from "@/components/artist/ArtistNetworkGraph";
import { ArtistStats } from "@/components/artist/ArtistStats";

interface ArtistStatsSectionProps {
  artistName: string;
  artistId?: number;
  artistEntityUid?: string;
}

export function ArtistStatsSection({
  artistName,
  artistId,
  artistEntityUid,
}: ArtistStatsSectionProps) {
  return (
    <div className="space-y-6">
      <ArtistStats artistId={artistId} artistEntityUid={artistEntityUid} />
      <InstrumentPanel
        as="section"
        headingLevel={3}
        label={{ children: "Artist Network", tone: "accent" }}
      >
        <ArtistNetworkGraph
          centerArtist={artistName}
          centerArtistId={artistId}
          centerArtistEntityUid={artistEntityUid}
        />
      </InstrumentPanel>
    </div>
  );
}
