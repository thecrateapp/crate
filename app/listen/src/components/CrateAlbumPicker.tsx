import { CrateAlbumPickerView } from "./CrateAlbumPickerView";
import { useCallback, useEffect, useState, type FormEvent } from "react";

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
    <CrateAlbumPickerView
      query={query}
      results={results}
      searching={searching}
      addingUid={addingUid}
      error={error}
      existingAlbumUids={existingAlbumUids}
      onQueryChange={setQuery}
      onSearch={search}
      onRetry={() => void searchAlbums(query)}
      onAdd={(album, uid) => void add(album, uid)}
      coverUrl={(album) => {
        const uid = catalogAlbumUid(album);
        return uid
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
      }}
      renderImage={(image) => (
        <CrateImage
          src={image.src}
          alt=""
          loading="lazy"
          className={image.className}
        />
      )}
    />
  );
}
