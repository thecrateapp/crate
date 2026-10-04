import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MediaGrid, SectionHeader } from "@crate/ui/domain/lists";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import {
  itemKey,
  ShowCard,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";

import type { GenreDetail } from "./explore-model";
import { buildRelatedGenreImageCandidates } from "./genre-covers";
import { GenreHero, type GenreActionBarProps } from "./GenreDetailHero";
import { GenreTile } from "./GenreTile";

type RelatedGenre = NonNullable<GenreDetail["related_genres"]>[number];

const RELATION_LABEL_KEY: Record<string, string> = {
  parent: "genre.relation.parent",
  child: "genre.relation.child",
  sibling: "genre.relation.sibling",
  related: "genre.relation.related",
  influenced_by: "genre.relation.influencedBy",
  influences: "genre.relation.influences",
  fusion: "genre.relation.fusion",
};

function RelatedGenreTile({
  genre,
  onOpen,
}: {
  genre: RelatedGenre;
  onOpen: (genre: RelatedGenre) => void;
}) {
  const { t } = useTranslation();
  const imageCandidates = useMemo(
    () => buildRelatedGenreImageCandidates(genre),
    [genre],
  );
  const relationKey = RELATION_LABEL_KEY[genre.relation_type];
  const detail = [
    genre.artist_count > 0
      ? t("common.artistCountLabel", { count: genre.artist_count })
      : null,
    genre.album_count > 0
      ? t("common.albumCountLabel", { count: genre.album_count })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <GenreTile
      variant="related"
      slug={genre.slug}
      name={genre.name}
      kicker={relationKey ? t(relationKey) : genre.relation_label}
      detail={detail}
      imageCandidates={imageCandidates}
      onOpen={() => onOpen(genre)}
    />
  );
}

function RelatedGenresSection({
  genres,
  onOpen,
}: {
  genres: RelatedGenre[];
  onOpen: (genre: RelatedGenre) => void;
}) {
  const { t } = useTranslation();
  if (!genres.length) return null;
  return (
    <section className="space-y-3">
      <SectionHeader
        title={t("genre.related.title")}
        subtitle={t("genre.related.subtitle")}
      />
      <MediaGrid>
        {genres.map((genre) => (
          <RelatedGenreTile
            key={`${genre.relation_type}-${genre.slug}`}
            genre={genre}
            onOpen={onOpen}
          />
        ))}
      </MediaGrid>
    </section>
  );
}

function ShowsSection({
  shows,
  expandedShowId,
  onToggle,
}: {
  shows: UpcomingItem[];
  expandedShowId: string | null;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (!shows.length) return null;
  return (
    <section className="space-y-3">
      <SectionHeader title={t("genre.sections.shows")} />
      <div className="grid gap-3 lg:grid-cols-2">
        {shows.map((show, index) => {
          const key = itemKey(show, index);
          return (
            <ShowCard
              key={key}
              item={show}
              expanded={expandedShowId === key}
              onToggle={() => onToggle(key)}
            />
          );
        })}
      </div>
    </section>
  );
}

function ArtistsSection({ artists }: { artists: GenreDetail["artists"] }) {
  const { t } = useTranslation();
  if (!artists.length) return null;
  return (
    <div className="space-y-3">
      <SectionHeader title={t("nav.collection.artists")} />
      <MediaGrid density="compact">
        {artists.map((artist) => (
          <ArtistCard
            key={
              artist.global_artist_uid ?? artist.artist_id ?? artist.artist_name
            }
            name={artist.artist_name}
            artistId={artist.artist_id}
            artistEntityUid={artist.artist_entity_uid}
            globalArtistUid={artist.global_artist_uid}
            artistSlug={artist.artist_slug}
            photo={artist.photo_url ?? undefined}
            hasPhoto={artist.has_photo}
            subtitle={t("common.albumCountLabel", {
              count: artist.album_count,
            })}
            compact
            layout="grid"
          />
        ))}
      </MediaGrid>
    </div>
  );
}

function AlbumsSection({ albums }: { albums: GenreDetail["albums"] }) {
  const { t } = useTranslation();
  if (!albums.length) return null;
  return (
    <div className="space-y-3">
      <SectionHeader title={t("nav.collection.albums")} />
      <MediaGrid>
        {albums.map((album) => (
          <AlbumCard
            key={
              album.global_album_uid ??
              album.album_id ??
              `${album.artist}-${album.name}`
            }
            artist={album.artist}
            album={album.name}
            albumId={album.album_id ?? undefined}
            albumEntityUid={album.album_entity_uid}
            globalAlbumUid={album.global_album_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.album_slug}
            year={album.year}
            cover={album.cover_url ?? undefined}
            layout="grid"
          />
        ))}
      </MediaGrid>
    </div>
  );
}

export function GenreDetailContent({
  actionBar,
  artistCount,
  artists,
  albumCount,
  albums,
  data,
  description,
  expandedShowId,
  heroCoverUrl,
  onCoverError,
  onOpenRelated,
  onToggleShow,
  relatedGenres,
  trackCount,
}: {
  actionBar: GenreActionBarProps;
  artistCount: number;
  artists: GenreDetail["artists"];
  albumCount: number;
  albums: GenreDetail["albums"];
  data: GenreDetail;
  description: string;
  expandedShowId: string | null;
  heroCoverUrl: string | null;
  onCoverError: () => void;
  onOpenRelated: (genre: RelatedGenre) => void;
  onToggleShow: (key: string) => void;
  relatedGenres: RelatedGenre[];
  trackCount: number;
}) {
  return (
    <div className="space-y-6">
      <GenreHero
        actionBar={actionBar}
        artistCount={artistCount}
        albumCount={albumCount}
        data={data}
        description={description}
        heroCoverUrl={heroCoverUrl}
        onCoverError={onCoverError}
        trackCount={trackCount}
      />
      <RelatedGenresSection genres={relatedGenres} onOpen={onOpenRelated} />
      <ShowsSection
        shows={data.shows?.slice(0, 5) ?? []}
        expandedShowId={expandedShowId}
        onToggle={onToggleShow}
      />
      <ArtistsSection artists={artists} />
      <AlbumsSection albums={albums} />
    </div>
  );
}
