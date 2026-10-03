import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Plus, Search } from "@crate/ui/icons";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { Input } from "@crate/ui/shadcn/input";

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
        <label className="relative block min-w-0">
          <span className="sr-only">{t("library.crates.searchAlbums")}</span>
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <Input
            type="search"
            aria-label={t("library.crates.searchAlbums")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder={t("library.crates.searchAlbums")}
            className="pl-9 pr-9"
          />
          {searching ? (
            <Loader2
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-muted"
            />
          ) : null}
        </label>
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
                    <Check size={15} aria-hidden="true" />
                    {t("library.crates.albumInCrate")}
                  </span>
                ) : (
                  <ActionIconButton
                    aria-label={addLabel}
                    title={addLabel}
                    disabled={!uid || addingUid === uid}
                    onClick={() => uid && void add(album, uid)}
                    tone="primary"
                    className="shrink-0 disabled:cursor-default"
                  >
                    {addingUid === uid ? (
                      <Loader2 size={17} className="animate-spin" />
                    ) : (
                      <Plus size={18} />
                    )}
                  </ActionIconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
