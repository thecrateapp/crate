import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { useApi } from "@/hooks/use-api";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";

import {
  albumCoverApiUrl,
  albumPagePath,
  albumRelatedApiPath,
} from "@/lib/library-routes";

interface RelatedAlbum {
  id?: number;
  slug?: string;
  name: string;
  display_name: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  year: string | null;
  track_count: number;
  has_cover: boolean;
  reason: string;
}

const REASON_LABELS: Record<string, string> = {
  same_artist: "Same Artist",
  genre_decade: "Similar Genre",
  audio_similar: "Similar Sound",
};

export function RelatedAlbums({ albumId }: { albumId?: number }) {
  const { data } = useApi<RelatedAlbum[]>(
    albumId != null ? albumRelatedApiPath({ albumId }) : null,
  );

  if (!data || data.length === 0) return null;

  return (
    <InstrumentPanel
      as="section"
      headingLevel={2}
      label={{ children: "Related albums", tone: "accent" }}
      meta="Editorial context"
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {data.map((album) => (
          <EntityCard
            key={`${album.id}-${album.artist}-${album.name}`}
            title={album.display_name || album.name}
            subtitle={album.artist}
            href={albumPagePath({
              albumId: album.id,
              albumSlug: album.slug,
              artistName: album.artist,
              albumName: album.name,
            })}
            cover={{
              src: album.has_cover
                ? albumCoverApiUrl({
                    albumId: album.id,
                    albumSlug: album.slug,
                    artistName: album.artist,
                    albumName: album.name,
                  })
                : null,
              alt: album.display_name || album.name,
            }}
            menuButton="none"
            meta={
              <InfoBadge>
                {REASON_LABELS[album.reason] || album.reason}
              </InfoBadge>
            }
          />
        ))}
      </div>
    </InstrumentPanel>
  );
}
