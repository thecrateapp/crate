import { useTranslation } from "react-i18next";

import { ArtistCard } from "@/components/cards/ArtistCard";

import type { GlobalArtist } from "./home-model";
import { SectionHeader, SectionLoading, SectionRail } from "./HomeSections";

export function JustLandedSection({
  artists,
  loading,
  onOpenExplore,
}: {
  artists?: GlobalArtist[];
  loading: boolean;
  onOpenExplore?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.library.justLanded.title")}
        subtitle={t("home.library.justLanded.subtitle")}
        actionLabel={onOpenExplore ? t("nav.explore") : undefined}
        onAction={onOpenExplore}
      />
      {loading ? (
        <SectionLoading />
      ) : artists?.length ? (
        <SectionRail
          fit="square-card"
          className="xl:grid-flow-row xl:grid-cols-7 xl:gap-4"
        >
          {artists.slice(0, 7).map((artist) => {
            const albumCount = artist.albums ?? artist.album_count ?? 0;
            const trackCount = artist.tracks ?? artist.track_count ?? 0;
            return (
              <ArtistCard
                key={`just-landed-${
                  artist.global_artist_uid ?? artist.id ?? artist.name
                }`}
                name={artist.name}
                artistId={artist.id}
                artistEntityUid={artist.entity_uid}
                globalArtistUid={artist.global_artist_uid}
                artistSlug={artist.slug}
                photo={artist.photo_url ?? undefined}
                hasPhoto={artist.has_photo}
                subtitle={`${t("common.albumCountLabel", {
                  count: albumCount,
                })} · ${t("common.trackCountLabel", {
                  count: trackCount,
                })}`}
                layout="grid"
                fillGrid
              />
            );
          })}
        </SectionRail>
      ) : (
        <div className="rounded-lg border border-dashed border-border-quiet px-4 py-6 text-sm text-text-muted">
          {t("home.library.justLanded.empty")}
        </div>
      )}
    </section>
  );
}
