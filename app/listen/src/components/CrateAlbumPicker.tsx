import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Search } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { api } from "@/lib/api";
import { catalogAlbumUid, type CatalogAlbum } from "@/pages/crates-types";

interface CrateAlbumPickerProps {
  existingAlbumUids: ReadonlySet<string>;
  onAdd: (album: CatalogAlbum) => Promise<void>;
}

interface CatalogSearchResponse {
  albums?: CatalogAlbum[];
}

export function CrateAlbumPicker({
  existingAlbumUids,
  onAdd,
}: CrateAlbumPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogAlbum[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingUid, setAddingUid] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    setError(false);
    try {
      const response = await api<CatalogSearchResponse>(
        `/api/catalog/search?q=${encodeURIComponent(trimmedQuery)}&limit=20`,
      );
      setResults(response.albums ?? []);
    } catch {
      setError(true);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function add(album: CatalogAlbum, uid: string) {
    setAddingUid(uid);
    try {
      await onAdd(album);
    } finally {
      setAddingUid(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-white/8 bg-white/[0.025] p-4">
      <h2 className="text-base font-semibold">
        {t("library.crates.addAlbums")}
      </h2>
      <form onSubmit={search} className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("library.crates.searchAlbums")}</span>
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            aria-label={t("library.crates.searchAlbums")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setError(false);
            }}
            placeholder={t("library.crates.searchAlbums")}
            className="h-11 w-full rounded-lg border border-white/10 bg-black/20 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
        </label>
        <button
          type="submit"
          disabled={searching || query.trim().length < 2}
          className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-white/8 px-3 text-sm font-medium text-foreground transition-colors hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? <Loader2 size={15} className="animate-spin" /> : null}
          {t("library.crates.findAlbums")}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("library.crates.searchFailed")}
        </p>
      )}
      {!searching &&
        !error &&
        query.trim().length >= 2 &&
        results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("library.crates.noAlbumsFound")}
          </p>
        )}

      {results.length > 0 && (
        <ul className="divide-y divide-white/6">
          {results.map((album, index) => {
            const uid = catalogAlbumUid(album);
            const alreadyAdded = uid ? existingAlbumUids.has(uid) : true;
            const cover = uid
              ? albumCoverApiUrl(
                  {
                    globalAlbumUid: uid,
                    albumId: album.id,
                    albumEntityUid: album.album_entity_uid,
                    artistEntityUid: album.artist_entity_uid,
                    albumSlug: album.slug,
                    artistSlug: album.artist_slug,
                    artistName: album.artist,
                    albumName: album.name,
                  },
                  { size: 128 },
                )
              : "";
            const addLabel = t("library.crates.addAlbum", {
              album: album.name,
              artist: album.artist,
            });

            return (
              <li
                key={uid ?? `${album.artist}:${album.name}:${index}`}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="size-11 shrink-0 overflow-hidden rounded-md bg-white/5">
                  {cover ? (
                    <CrateImage
                      src={cover}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {album.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {album.artist}
                    {album.year ? ` · ${album.year}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={addLabel}
                  title={addLabel}
                  disabled={!uid || alreadyAdded || addingUid === uid}
                  onClick={() => uid && void add(album, uid)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 disabled:cursor-default disabled:text-white/25"
                >
                  {addingUid === uid ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Plus size={18} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
