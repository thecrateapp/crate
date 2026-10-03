import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { type ArtistAlbum } from "@/components/artist/artist-model";

import {
  buildArtistAlbumPresentation,
  releaseCategory,
  RELEASE_GROUPS,
  type ArtistReleaseCategory,
} from "./artist-library-model";

interface ArtistAlbumsSectionProps {
  artistName: string;
  artistSlug?: string;
  albums: ArtistAlbum[];
}

function ArtistAlbumItem({
  album,
  artistName,
  artistSlug,
}: {
  album: ArtistAlbum;
  artistName: string;
  artistSlug?: string;
}) {
  const presentation = buildArtistAlbumPresentation(
    album,
    artistName,
    artistSlug,
  );

  return (
    <AlbumCard
      artist={artistName}
      album={presentation.albumName}
      albumId={presentation.localAlbumId}
      albumEntityUid={album.entity_uid ?? undefined}
      globalAlbumUid={presentation.globalAlbumUid ?? undefined}
      albumSlug={album.slug}
      artistSlug={artistSlug}
      year={album.year?.slice(0, 4)}
      cover={presentation.cover}
      isPreRelease={album.is_pre_release}
      releaseDate={album.release_date}
      layout="grid"
    />
  );
}

export function ArtistAlbumsSection({
  artistName,
  artistSlug,
  albums,
}: ArtistAlbumsSectionProps) {
  const { t } = useTranslation();
  const groupedAlbums = useMemo(() => {
    const albumsByCategory = new Map<ArtistReleaseCategory, ArtistAlbum[]>();
    for (const album of albums) {
      const category = releaseCategory(album);
      const categoryAlbums = albumsByCategory.get(category) ?? [];
      categoryAlbums.push(album);
      albumsByCategory.set(category, categoryAlbums);
    }

    return RELEASE_GROUPS.flatMap((group) => {
      const categoryAlbums = albumsByCategory.get(group.category);
      return categoryAlbums?.length
        ? [{ ...group, albums: categoryAlbums }]
        : [];
    });
  }, [albums]);
  if (!albums.length) return null;

  return (
    <div className="space-y-10">
      {groupedAlbums.map((group) => (
        <section key={group.category}>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">
            {t(group.labelKey)}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {group.albums.map((album) => (
              <ArtistAlbumItem
                key={
                  album.global_album_uid ??
                  album.global_uid ??
                  album.id ??
                  `${album.name}-${album.year}`
                }
                album={album}
                artistName={artistName}
                artistSlug={artistSlug}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
