import { useTranslation } from "react-i18next";
import { MediaGrid, SectionHeader } from "@crate/ui/domain/lists";

import { ArtistCard } from "@/components/cards/ArtistCard";
import { artistPagePath } from "@/lib/library-routes";

import { artistGlobalUid, type SearchArtist } from "./search-results-model";

export function SearchArtistResults({ artists }: { artists: SearchArtist[] }) {
  const { t } = useTranslation();

  return (
    <section>
      <SectionHeader
        className="mb-3"
        title={t("search.artistsCount", { count: artists.length })}
      />
      <MediaGrid density="compact">
        {artists.map((artist) => {
          const globalUid = artistGlobalUid(artist);
          return globalUid ? (
            <ArtistCard
              key={globalUid}
              name={artist.name}
              globalArtistUid={globalUid}
              hasPhoto={artist.has_photo}
              layout="grid"
              href={artistPagePath({
                artistId: artist.id,
                artistEntityUid: artist.entity_uid,
                globalArtistUid: globalUid,
                artistSlug: artist.slug,
                artistName: artist.name,
              })}
            />
          ) : (
            <ArtistCard
              key={artist.id || artist.entity_uid || artist.name}
              name={artist.name}
              artistId={artist.id}
              artistEntityUid={artist.entity_uid}
              artistSlug={artist.slug}
              layout="grid"
            />
          );
        })}
      </MediaGrid>
    </section>
  );
}
