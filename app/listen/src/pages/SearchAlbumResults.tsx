import { useTranslation } from "react-i18next";
import {
  SearchAlbumResultsView,
  type SearchAlbumViewItem,
} from "./SearchAlbumResultsView";
import { CRATE_ICON_SIZE, Disc3 } from "@crate/ui/icons";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { albumGlobalUid, type SearchAlbum } from "./search-results-model";
const LAZY_IMAGE_PROPS = { loading: "lazy" } as const;
const ALBUM_COVER_FALLBACK = (
  <div className="flex size-full items-center justify-center">
    <Disc3 size={CRATE_ICON_SIZE.xl} className="text-text-primary/25" />
  </div>
);
export function SearchAlbumResults({ albums }: { albums: SearchAlbum[] }) {
  const { t } = useTranslation();
  const items: SearchAlbumViewItem[] = albums.map((album) => {
    const globalUid = albumGlobalUid(album);
    if (!globalUid)
      return {
        key: album.id || album.entity_uid || album.artist + "-" + album.name,
        content: (
          <AlbumCard
            layout="grid"
            artist={album.artist}
            album={album.name}
            albumId={album.id}
            albumEntityUid={album.entity_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.slug}
            year={album.year}
          />
        ),
      };
    return {
      key: globalUid,
      title: album.name,
      subtitle: album.year ? album.year + " · " + album.artist : album.artist,
      href: albumPagePath({
        albumId: album.id,
        albumEntityUid: album.entity_uid,
        globalAlbumUid: globalUid,
        albumSlug: album.slug,
        artistSlug: album.artist_slug,
        artistName: album.artist,
        albumName: album.name,
      }),
      artwork: (
        <ArtworkSurface
          source={
            album.has_cover
              ? albumCoverApiUrl({ globalAlbumUid: globalUid }, { size: 320 })
              : null
          }
          alt={album.name}
          fallback={ALBUM_COVER_FALLBACK}
          imageProps={LAZY_IMAGE_PROPS}
          imageClassName="object-cover"
          className="size-full"
        />
      ),
    };
  });
  return (
    <SearchAlbumResultsView
      title={t("search.albumsCount", { count: albums.length })}
      items={items}
    />
  );
}
