import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Check, Loader2, Plus } from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

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

  const searchAlbums = useCallback(async (rawQuery: string) => {
    const trimmedQuery = rawQuery.trim();
    if (trimmedQuery.length < 2) {
      setResults([]);
      setSearching(false);
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
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      setResults([]);
      setError(false);
      setSearching(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchAlbums(trimmedQuery);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, searchAlbums]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchAlbums(query);
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
    <section className="space-y-3 rounded-xl border border-border-quiet bg-text-primary/[0.025] p-4">
      <h2 className="text-base font-semibold">
        {t("library.crates.addAlbums")}
      </h2>
      <form onSubmit={search} role="search">
        <div className="relative min-w-0">
          <SearchInput
            label={t("library.crates.searchAlbums")}
            clearLabel={t("search.clear")}
            value={query}
            onValueChange={setQuery}
            placeholder={t("library.crates.searchAlbums")}
          />
          {searching ? (
            <Loader2
              size={CRATE_ICON_SIZE.sm}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-10 -translate-y-1/2 animate-spin text-text-muted"
            />
          ) : null}
        </div>
      </form>

      {error && (
        <p role="alert" className="text-sm text-state-danger">
          {t("library.crates.searchFailed")}
        </p>
      )}
      {!searching &&
        !error &&
        query.trim().length >= 2 &&
        results.length === 0 && (
          <p className="text-sm text-text-muted">
            {t("library.crates.noAlbumsFound")}
          </p>
        )}

      {results.length > 0 && (
        <ul className="divide-y divide-text-primary/6">
          {results.map((album) => {
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
                key={
                  uid ??
                  album.id ??
                  `${album.artist}:${album.name}:${album.year ?? ""}`
                }
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="size-11 shrink-0 overflow-hidden rounded-md bg-text-primary/5">
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
                  <p className="truncate text-sm font-medium text-text-primary">
                    {album.name}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {album.artist}
                    {album.year ? ` · ${album.year}` : ""}
                  </p>
                </div>
                {uid && alreadyAdded ? (
                  <span className="flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-xs font-medium text-accent-action">
                    <Check size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
                    {t("library.crates.albumInCrate")}
                  </span>
                ) : (
                  <IconButton
                    label={addLabel}
                    tone="primary"
                    disabled={!uid}
                    loading={addingUid === uid}
                    onClick={() => uid && void add(album, uid)}
                  >
                    <Plus size={CRATE_ICON_SIZE.md} />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
