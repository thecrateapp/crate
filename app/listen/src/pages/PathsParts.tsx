import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Loader2, MapPin, Music } from "@crate/ui/icons";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

import { CrateImage } from "@/components/artwork/CrateImage";
import { api } from "@/lib/api";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import type { SearchResult } from "./paths-model";

export function EndpointPanel({
  side,
  selected,
  onSelect,
}: {
  side: "origin" | "destination";
  selected: SearchResult | null;
  onSelect: (result: SearchResult | null) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const [searchData, genresData] = await Promise.all([
        api<{
          artists?: {
            id: number;
            entity_uid?: string;
            name: string;
            slug?: string;
          }[];
          albums?: {
            id: number;
            entity_uid?: string;
            name: string;
            artist: string;
            slug?: string;
            album_id?: number;
            artist_entity_uid?: string;
          }[];
          tracks?: {
            id: number;
            entity_uid?: string;
            title: string;
            artist: string;
            album_id?: number;
            album_entity_uid?: string;
            artist_id?: number;
            artist_entity_uid?: string;
            artist_slug?: string;
          }[];
        }>(`/api/catalog/search?q=${encodeURIComponent(q)}&limit=5`),
        api<{ slug: string; name: string }[]>("/api/genres"),
      ]);

      const items: SearchResult[] = [];
      const qLower = q.toLowerCase();
      for (const genre of genresData
        .filter((item) => item.name.toLowerCase().includes(qLower))
        .slice(0, 3)) {
        items.push({ type: "genre", value: genre.slug, label: genre.name });
      }
      for (const artist of searchData.artists?.slice(0, 3) ?? []) {
        items.push({
          type: "artist",
          value: artist.entity_uid || String(artist.id),
          label: artist.name,
          artistId: artist.id,
          artistEntityUid: artist.entity_uid,
          artistSlug: artist.slug,
          imageUrl: artistPhotoApiUrl(
            {
              artistId: artist.id,
              artistEntityUid: artist.entity_uid,
              artistSlug: artist.slug,
              artistName: artist.name,
            },
            { size: 128 },
          ),
        });
      }
      for (const album of searchData.albums?.slice(0, 3) ?? []) {
        items.push({
          type: "album",
          value: album.entity_uid || String(album.album_id ?? album.id ?? 0),
          label: `${album.name} — ${album.artist}`,
          albumId: album.album_id ?? album.id,
          albumEntityUid: album.entity_uid,
          artistEntityUid: album.artist_entity_uid,
          imageUrl: albumCoverApiUrl(
            {
              albumId: album.album_id ?? album.id,
              albumEntityUid: album.entity_uid,
              artistEntityUid: album.artist_entity_uid,
              albumName: album.name,
              artistName: album.artist,
            },
            { size: 128 },
          ),
        });
      }
      for (const track of searchData.tracks?.slice(0, 2) ?? []) {
        items.push({
          type: "track",
          value: track.entity_uid || String(track.id),
          label: `${track.title} — ${track.artist}`,
          albumId: track.album_id,
          albumEntityUid: track.album_entity_uid,
          artistId: track.artist_id,
          artistEntityUid: track.artist_entity_uid,
          imageUrl:
            track.album_id || track.album_entity_uid
              ? albumCoverApiUrl(
                  {
                    albumId: track.album_id,
                    albumEntityUid: track.album_entity_uid,
                  },
                  { size: 128 },
                )
              : undefined,
        });
      }
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const label =
    side === "origin" ? t("paths.endpoint.from") : t("paths.endpoint.to");

  return (
    <div
      className={`relative flex-1 overflow-hidden rounded-xl border transition-colors ${
        selected
          ? "border-accent-action/30 bg-accent-action/5"
          : "border-text-primary/8 bg-text-primary/[0.02]"
      }`}
    >
      {selected?.imageUrl ? (
        <div className="absolute inset-0">
          <CrateImage
            src={selected.imageUrl}
            alt=""
            className=" size-full object-cover opacity-20 blur-sm"
          />
          <div className="absolute inset-0 bg-linear-to-t from-surface-canvas/90 via-surface-canvas/70 to-surface-canvas/50" />
        </div>
      ) : null}

      <div className="relative p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-action/60">
          <MapPin size={CRATE_ICON_SIZE.micro} className="mr-1 inline" />
          {label}
        </div>

        {selected ? (
          <div>
            {selected.imageUrl ? (
              <div className="mb-3 size-24 overflow-hidden rounded-xl bg-text-primary/5 shadow-lg">
                <CrateImage
                  src={selected.imageUrl}
                  alt=""
                  className=" size-full object-cover"
                />
              </div>
            ) : null}
            <div className="text-lg font-bold text-text-primary">
              {selected.label}
            </div>
            <div className="mt-0.5 text-xs text-accent-action/70">
              {selected.type}
            </div>
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setQuery("");
                setResults([]);
              }}
              className="link-meta mt-3 text-xs"
            >
              {t("common.change")}
            </button>
          </div>
        ) : (
          <div>
            <SearchInput
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                void search(value);
              }}
              label={label}
              clearLabel={t("common.clear")}
              placeholder={t("paths.endpoint.placeholder")}
              className="rounded-lg bg-surface-canvas/30 shadow-none backdrop-blur-none placeholder:text-text-primary/25 focus-visible:border-accent-action/30 md:text-base"
            />
            {searching ? (
              <Loader2
                size={CRATE_ICON_SIZE.xs}
                className="mt-2 animate-spin text-accent-action"
              />
            ) : null}
            {results.length > 0 ? (
              <div className="mt-2 space-y-0.5 rounded-xl border border-text-primary/8 bg-surface-canvas/40 p-1.5">
                {results.map((result) => (
                  <button
                    key={`${result.type}-${result.value}`}
                    type="button"
                    onClick={() => {
                      onSelect(result);
                      setQuery("");
                      setResults([]);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-text-primary/70 transition hover:bg-text-primary/5 hover:text-text-primary"
                  >
                    {result.imageUrl ? (
                      <CrateImage
                        src={result.imageUrl}
                        alt=""
                        className={` size-8 shrink-0 bg-text-primary/5 object-cover ${
                          result.type === "artist"
                            ? "rounded-full"
                            : "rounded-md"
                        }`}
                      />
                    ) : (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-action/10 text-accent-action">
                        <Music size={14} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[0.8125rem]">
                        {result.label}
                      </div>
                      <div className="text-xs text-text-primary/30">
                        {result.type}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
