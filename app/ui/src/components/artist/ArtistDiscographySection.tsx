import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { FormField } from "@crate/ui/primitives/FormField";
import { AdminSelect } from "@/components/ui";
import { AlbumCard } from "@/components/album/AlbumCard";
import { MissingAlbumCard } from "@/components/album/MissingAlbumCard";
import { TidalAlbumCard } from "@/components/album/TidalAlbumCard";
import type { ArtistAlbumSummary } from "@/components/artist/artistPageTypes";
import { Button } from "@crate/ui/shadcn/button";

interface MissingAlbum {
  title: string;
  first_release_date: string;
  type: string;
}

interface TidalMissingAlbum {
  url: string;
  title: string;
  year: string;
  tracks: number;
  cover: string | null;
  quality: string;
}

interface ArtistDiscographySectionProps {
  artistName: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  albums: ArtistAlbumSummary[];
  sortedAlbums: ArtistAlbumSummary[];
  missingAlbums: MissingAlbum[];
  tidalMissing: TidalMissingAlbum[];
  showMissing: boolean;
  sort: string;
  downloadingDiscog: boolean;
  canDownloadTidal?: boolean;
  onToggleShowMissing: () => void;
  onSortChange: (value: string) => void;
  onDownloadDiscography: () => Promise<void> | void;
}

export function ArtistDiscographySection({
  artistName,
  artistId,
  artistEntityUid,
  artistSlug,
  albums,
  sortedAlbums,
  missingAlbums,
  tidalMissing,
  showMissing,
  sort,
  downloadingDiscog,
  canDownloadTidal = false,
  onToggleShowMissing,
  onSortChange,
  onDownloadDiscography,
}: ArtistDiscographySectionProps) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <MonoLabel as="h2" tone="accent">
              Albums
            </MonoLabel>
            <InfoBadge variant="counter">{albums.length}</InfoBadge>
          </div>
          {missingAlbums.length > 0 && (
            <FilterChip active={showMissing} onClick={onToggleShowMissing}>
              {showMissing ? "Hide" : "Show"} missing ({missingAlbums.length})
            </FilterChip>
          )}
          {canDownloadTidal && tidalMissing.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              loading={downloadingDiscog}
              onClick={() => {
                void onDownloadDiscography();
              }}
            >
              Complete Discography ({tidalMissing.length} from Tidal)
            </Button>
          )}
        </div>
        <FormField label="Sort albums" className="w-44">
          <AdminSelect
            ariaLabel="Sort albums"
            placeholder="Sort albums"
            value={sort}
            onChange={onSortChange}
            allowClear={false}
            options={[
              { value: "name", label: "Name" },
              { value: "year", label: "Newest" },
              { value: "tracks", label: "Most Tracks" },
            ]}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {(() => {
          type GridItem =
            | { kind: "local"; album: ArtistAlbumSummary }
            | { kind: "tidal"; album: TidalMissingAlbum }
            | { kind: "missing"; album: MissingAlbum };

          const items: GridItem[] = sortedAlbums.map((album) => ({
            kind: "local",
            album,
          }));
          const tidalTitles = new Set(
            tidalMissing.map((album) => album.title.toLowerCase()),
          );

          for (const album of tidalMissing) {
            items.push({ kind: "tidal", album });
          }

          if (showMissing) {
            for (const album of missingAlbums) {
              if (!tidalTitles.has(album.title.toLowerCase())) {
                items.push({ kind: "missing", album });
              }
            }
          }

          if (sort === "year") {
            items.sort((a, b) => {
              const yearA =
                a.kind === "local"
                  ? a.album.year || ""
                  : a.kind === "tidal"
                    ? a.album.year || ""
                    : a.album.first_release_date || "";
              const yearB =
                b.kind === "local"
                  ? b.album.year || ""
                  : b.kind === "tidal"
                    ? b.album.year || ""
                    : b.album.first_release_date || "";
              return yearB.localeCompare(yearA);
            });
          }

          return items.map((item) =>
            item.kind === "local" ? (
              <AlbumCard
                key={`local-${item.album.name}`}
                albumId={item.album.id}
                albumEntityUid={item.album.entity_uid}
                albumSlug={item.album.slug}
                artist={artistName}
                artistId={artistId}
                artistEntityUid={artistEntityUid}
                artistSlug={artistSlug}
                name={item.album.name}
                displayName={item.album.display_name}
                year={item.album.year}
                tracks={item.album.tracks}
                formats={item.album.formats}
                bitDepth={item.album.bit_depth}
                sampleRate={item.album.sample_rate}
                hasCover={item.album.has_cover}
              />
            ) : item.kind === "tidal" ? (
              artistId != null ? (
                <TidalAlbumCard
                  key={`tidal-${item.album.url}`}
                  artist={artistName}
                  artistId={artistId}
                  artistEntityUid={artistEntityUid}
                  title={item.album.title}
                  year={item.album.year}
                  tracks={item.album.tracks}
                  cover={item.album.cover}
                  url={item.album.url}
                />
              ) : null
            ) : (
              <MissingAlbumCard
                key={`missing-${item.album.title}`}
                title={item.album.title}
                year={item.album.first_release_date}
                type={item.album.type}
              />
            ),
          );
        })()}
      </div>
    </div>
  );
}
