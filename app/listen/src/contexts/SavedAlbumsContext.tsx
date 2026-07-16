import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/lib/api";
import { onCacheInvalidation } from "@/lib/cache";

export interface SavedAlbum {
  saved_at: string;
  id?: number | null;
  global_album_uid?: string;
  artist: string;
  name: string;
  year: string;
  has_cover: boolean;
  track_count: number;
  total_duration: number;
}

interface SavedAlbumsContextValue {
  savedAlbums: SavedAlbum[];
  loading: boolean;
  isSaved: (albumId?: number | null, globalAlbumUid?: string | null) => boolean;
  saveAlbum: (
    albumId?: number | null,
    globalAlbumUid?: string | null,
  ) => Promise<boolean>;
  unsaveAlbum: (
    albumId?: number | null,
    globalAlbumUid?: string | null,
  ) => Promise<boolean>;
  toggleAlbumSaved: (
    albumId?: number | null,
    globalAlbumUid?: string | null,
  ) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const SavedAlbumsContext = createContext<SavedAlbumsContextValue | null>(null);

export function SavedAlbumsProvider({ children }: { children: ReactNode }) {
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const savedAlbumsRequestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    savedAlbumsRequestRef.current?.abort();
    const controller = new AbortController();
    savedAlbumsRequestRef.current = controller;
    setLoading(true);
    try {
      const albums = await api<SavedAlbum[]>(
        "/api/catalog/me/albums/saved",
        "GET",
        undefined,
        {
          signal: controller.signal,
        },
      );
      setSavedAlbums(Array.isArray(albums) ? albums : []);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
    } finally {
      if (savedAlbumsRequestRef.current === controller) {
        savedAlbumsRequestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      savedAlbumsRequestRef.current?.abort();
      savedAlbumsRequestRef.current = null;
    };
  }, [refetch]);

  // Sync with backend when SSE invalidation fires for "saved_albums"
  useEffect(() => {
    return onCacheInvalidation((scope: string) => {
      if (scope === "saved_albums") void refetch();
    });
  }, [refetch]);

  const savedIds = useMemo(
    () =>
      new Set(
        savedAlbums.flatMap((album) => (album.id != null ? [album.id] : [])),
      ),
    [savedAlbums],
  );
  const savedGlobalUids = useMemo(
    () =>
      new Set(
        savedAlbums.flatMap((album) =>
          album.global_album_uid ? [album.global_album_uid] : [],
        ),
      ),
    [savedAlbums],
  );

  const isSaved = useCallback(
    (albumId?: number | null, globalAlbumUid?: string | null) => {
      if (globalAlbumUid) return savedGlobalUids.has(globalAlbumUid);
      if (albumId == null) return false;
      return savedIds.has(albumId);
    },
    [savedGlobalUids, savedIds],
  );

  const saveAlbum = useCallback(
    async (albumId?: number | null, globalAlbumUid?: string | null) => {
      if (albumId == null && !globalAlbumUid) return false;
      if (globalAlbumUid) {
        await api(
          `/api/catalog/me/albums/${encodeURIComponent(globalAlbumUid)}/save`,
          "POST",
        );
      } else {
        await api("/api/me/albums", "POST", { album_id: albumId });
      }
      await refetch();
      return true;
    },
    [refetch],
  );

  const unsaveAlbum = useCallback(
    async (albumId?: number | null, globalAlbumUid?: string | null) => {
      if (albumId == null && !globalAlbumUid) return false;
      if (globalAlbumUid) {
        await api(
          `/api/catalog/me/albums/${encodeURIComponent(globalAlbumUid)}/save`,
          "DELETE",
        );
      } else {
        await api(`/api/me/albums/${albumId}`, "DELETE");
      }
      setSavedAlbums((prev) =>
        prev.filter((album) =>
          globalAlbumUid
            ? album.global_album_uid !== globalAlbumUid
            : album.id !== albumId,
        ),
      );
      return true;
    },
    [],
  );

  const toggleAlbumSaved = useCallback(
    async (albumId?: number | null, globalAlbumUid?: string | null) => {
      if (albumId == null && !globalAlbumUid) return false;
      if (
        globalAlbumUid
          ? savedGlobalUids.has(globalAlbumUid)
          : albumId != null && savedIds.has(albumId)
      ) {
        return unsaveAlbum(albumId, globalAlbumUid);
      }
      return saveAlbum(albumId, globalAlbumUid);
    },
    [saveAlbum, savedGlobalUids, savedIds, unsaveAlbum],
  );

  const value = useMemo<SavedAlbumsContextValue>(
    () => ({
      savedAlbums,
      loading,
      isSaved,
      saveAlbum,
      unsaveAlbum,
      toggleAlbumSaved,
      refetch,
    }),
    [
      savedAlbums,
      loading,
      isSaved,
      saveAlbum,
      unsaveAlbum,
      toggleAlbumSaved,
      refetch,
    ],
  );

  return (
    <SavedAlbumsContext.Provider value={value}>
      {children}
    </SavedAlbumsContext.Provider>
  );
}

export function useSavedAlbums() {
  const ctx = useContext(SavedAlbumsContext);
  if (!ctx)
    throw new Error("useSavedAlbums must be used within SavedAlbumsProvider");
  return ctx;
}
