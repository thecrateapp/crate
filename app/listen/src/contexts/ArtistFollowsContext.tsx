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

interface FollowedArtist {
  artist_name: string;
  artist_id?: number;
  global_artist_uid?: string;
  artist_slug?: string;
  created_at: string;
}

interface ArtistFollowsContextValue {
  followedArtists: FollowedArtist[];
  loading: boolean;
  isFollowing: (
    artistId?: number | null,
    globalArtistUid?: string | null,
  ) => boolean;
  followArtist: (
    artistId?: number | null,
    globalArtistUid?: string | null,
    artistName?: string | null,
  ) => Promise<boolean>;
  unfollowArtist: (
    artistId?: number | null,
    globalArtistUid?: string | null,
  ) => Promise<boolean>;
  toggleArtistFollow: (
    artistId?: number | null,
    globalArtistUid?: string | null,
    artistName?: string | null,
  ) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const ArtistFollowsContext = createContext<ArtistFollowsContextValue | null>(
  null,
);

export function ArtistFollowsProvider({ children }: { children: ReactNode }) {
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);

    try {
      const artists = await api<FollowedArtist[]>(
        "/api/catalog/me/follows",
        "GET",
        undefined,
        {
          signal: controller.signal,
        },
      );
      setFollowedArtists(Array.isArray(artists) ? artists : []);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [refetch]);

  // Sync with backend when SSE invalidation fires for "follows"
  useEffect(() => {
    return onCacheInvalidation((scope: string) => {
      if (scope === "follows") void refetch();
    });
  }, [refetch]);

  const followedIds = useMemo(
    () =>
      new Set(
        followedArtists.flatMap((artist) =>
          artist.artist_id != null ? [artist.artist_id] : [],
        ),
      ),
    [followedArtists],
  );
  const followedGlobalUids = useMemo(
    () =>
      new Set(
        followedArtists.flatMap((artist) =>
          artist.global_artist_uid ? [artist.global_artist_uid] : [],
        ),
      ),
    [followedArtists],
  );

  const isFollowing = useCallback(
    (artistId?: number | null, globalArtistUid?: string | null) => {
      if (globalArtistUid) return followedGlobalUids.has(globalArtistUid);
      if (artistId == null) return false;
      return followedIds.has(artistId);
    },
    [followedGlobalUids, followedIds],
  );

  const followArtist = useCallback(
    async (
      artistId?: number | null,
      globalArtistUid?: string | null,
      artistName?: string | null,
    ) => {
      if (artistId == null && !globalArtistUid) return false;
      // Optimistic: stamp the follow locally before the request resolves. If the
      // request fails we roll back. Avoids the global loading flash from refetch().
      const placeholder: FollowedArtist = {
        artist_id: artistId ?? undefined,
        global_artist_uid: globalArtistUid || undefined,
        artist_name: artistName || "",
        created_at: new Date().toISOString(),
      };
      setFollowedArtists((prev) => {
        if (
          prev.some((artist) =>
            globalArtistUid
              ? artist.global_artist_uid === globalArtistUid
              : artist.artist_id === artistId,
          )
        )
          return prev;
        return [placeholder, ...prev];
      });
      try {
        if (globalArtistUid) {
          await api(
            `/api/catalog/me/follows/${encodeURIComponent(globalArtistUid)}`,
            "POST",
          );
        } else {
          await api(`/api/me/follows/artists/${artistId}`, "POST");
        }
        return true;
      } catch (error) {
        setFollowedArtists((prev) =>
          prev.filter((artist) =>
            globalArtistUid
              ? artist.global_artist_uid !== globalArtistUid
              : artist.artist_id !== artistId,
          ),
        );
        throw error;
      }
    },
    [],
  );

  const unfollowArtist = useCallback(
    async (artistId?: number | null, globalArtistUid?: string | null) => {
      if (artistId == null && !globalArtistUid) return false;
      const previous = followedArtists;
      setFollowedArtists((prev) =>
        prev.filter((artist) =>
          globalArtistUid
            ? artist.global_artist_uid !== globalArtistUid
            : artist.artist_id !== artistId,
        ),
      );
      try {
        if (globalArtistUid) {
          await api(
            `/api/catalog/me/follows/${encodeURIComponent(globalArtistUid)}`,
            "DELETE",
          );
        } else {
          await api(`/api/me/follows/artists/${artistId}`, "DELETE");
        }
        return true;
      } catch (error) {
        setFollowedArtists(previous);
        throw error;
      }
    },
    [followedArtists],
  );

  const toggleArtistFollow = useCallback(
    async (
      artistId?: number | null,
      globalArtistUid?: string | null,
      artistName?: string | null,
    ) => {
      if (artistId == null && !globalArtistUid) return false;
      if (
        globalArtistUid
          ? followedGlobalUids.has(globalArtistUid)
          : artistId != null && followedIds.has(artistId)
      ) {
        return unfollowArtist(artistId, globalArtistUid);
      }
      return followArtist(artistId, globalArtistUid, artistName);
    },
    [followArtist, followedGlobalUids, followedIds, unfollowArtist],
  );

  const value = useMemo<ArtistFollowsContextValue>(
    () => ({
      followedArtists,
      loading,
      isFollowing,
      followArtist,
      unfollowArtist,
      toggleArtistFollow,
      refetch,
    }),
    [
      followArtist,
      followedArtists,
      isFollowing,
      loading,
      refetch,
      toggleArtistFollow,
      unfollowArtist,
    ],
  );

  return (
    <ArtistFollowsContext.Provider value={value}>
      {children}
    </ArtistFollowsContext.Provider>
  );
}

export function useArtistFollows() {
  const ctx = useContext(ArtistFollowsContext);
  if (!ctx)
    throw new Error(
      "useArtistFollows must be used within ArtistFollowsProvider",
    );
  return ctx;
}
