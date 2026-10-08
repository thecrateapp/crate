import { useTranslation } from "react-i18next";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { MediaRail, SectionHeader } from "@crate/ui/domain/lists";

import type { HomeSectionId, HomeSuggestedAlbum } from "./home-model";

export function SuggestedAlbumsSection({
  albums,
  onViewAll,
}: {
  albums: HomeSuggestedAlbum[];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  if (!albums.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.suggestedAlbums.title")}
        subtitle={t("home.sections.suggestedAlbums.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("suggested-albums")}
      />
      <MediaRail fit="columns">
        {albums.map((album) => (
          <AlbumCard
            key={`${
              album.global_album_uid ??
              album.album_id ??
              `${album.artist_name}-${album.album_name}`
            }`}
            artist={album.artist_name}
            album={album.album_name}
            albumId={album.album_id}
            albumEntityUid={album.album_entity_uid}
            globalAlbumUid={album.global_album_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.album_slug}
            year={album.year}
            cover={album.cover_url ?? undefined}
            layout="grid"
          />
        ))}
      </MediaRail>
    </section>
  );
}

export function UpcomingAlbumsSection({
  albums,
  onViewAll,
}: {
  albums: HomeSuggestedAlbum[];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  if (!albums.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.upcomingAlbums.title")}
        subtitle={t("home.sections.upcomingAlbums.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("upcoming-albums")}
      />
      <MediaRail fit="columns">
        {albums.map((album) => (
          <AlbumCard
            key={`upcoming-${
              album.global_album_uid ??
              album.album_id ??
              `${album.artist_name}-${album.album_name}`
            }`}
            artist={album.artist_name}
            album={album.album_name}
            albumId={album.album_id}
            albumEntityUid={album.album_entity_uid}
            globalAlbumUid={album.global_album_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.album_slug}
            artistSlug={album.artist_slug}
            year={album.year}
            cover={album.cover_url ?? undefined}
            isPreRelease={album.is_pre_release}
            releaseDate={album.release_date}
            layout="grid"
          />
        ))}
      </MediaRail>
    </section>
  );
}
