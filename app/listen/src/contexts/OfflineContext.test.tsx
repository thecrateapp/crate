import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearOfflineAssetsMock,
  abortOfflineTransferMock,
  hydrateOfflineProfileStateMock,
  isOfflineSupportedMock,
  saveOfflineSnapshotMock,
  setActiveOfflineProfileKeyMock,
  syncOfflineProfileToServiceWorkerMock,
  offlineSyncOperationMock,
} = vi.hoisted(() => ({
  clearOfflineAssetsMock: vi.fn(async () => {}),
  abortOfflineTransferMock: vi.fn(),
  hydrateOfflineProfileStateMock: vi.fn(async () => ({
    items: {
      "track:storage-1": {
        key: "track:storage-1",
        kind: "track",
        entityId: "storage-1",
        title: "Track One",
        state: "ready",
        trackCount: 1,
        readyTrackCount: 1,
        totalBytes: 1234,
        readyAssetKeys: ["storage-1"],
        tracks: [
          {
            entity_uid: "entity-1",
            storage_id: "storage-1",
            title: "Track One",
            artist: "Artist",
            stream_url: "/api/tracks/by-entity/entity-1/stream",
            download_url: "/api/tracks/by-entity/entity-1/download",
          },
        ],
      },
    },
  })),
  isOfflineSupportedMock: vi.fn(() => true),
  saveOfflineSnapshotMock: vi.fn(),
  setActiveOfflineProfileKeyMock: vi.fn(),
  syncOfflineProfileToServiceWorkerMock: vi.fn(),
  offlineSyncOperationMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/offline", () => ({
  buildAssetUsage: vi.fn(() => new Map()),
  cacheTrackAsset: vi.fn(async () => {}),
  clearOfflineAssets: clearOfflineAssetsMock,
  deleteCachedTrackAsset: vi.fn(async () => {}),
  deriveOfflineProfileKey: vi.fn(() => "profile-1"),
  ensureOfflineStorageBudget: vi.fn(async () => {}),
  getOfflineItemKey: (kind: string, entityId: string | number) =>
    `${kind}:${entityId}`,
  getOfflineTrackAssetKey: (
    track:
      | string
      | {
          entity_uid?: string | null;
          storage_id?: string | null;
          track_id?: number | null;
          entityUid?: string | null;
          storageId?: string | null;
          trackId?: number | null;
          libraryTrackId?: number | null;
          path?: string | null;
        },
  ) => {
    if (typeof track === "string") return track;
    return (
      track.entity_uid ||
      track.entityUid ||
      track.storage_id ||
      track.storageId ||
      (track.track_id != null ? String(track.track_id) : null) ||
      (track.libraryTrackId != null ? String(track.libraryTrackId) : null) ||
      (track.trackId != null ? String(track.trackId) : null) ||
      track.path ||
      null
    );
  },
  getOfflineTrackManifestPaths: vi.fn(() => ["/api/offline/tracks/1/manifest"]),
  hasCachedTrackAssets: vi.fn(async () => new Set()),
  hydrateOfflineProfileState: hydrateOfflineProfileStateMock,
  isOfflineBusy: (state: string) =>
    ["queued", "downloading", "syncing"].includes(state),
  isOfflineSupported: isOfflineSupportedMock,
  saveOfflineSnapshot: saveOfflineSnapshotMock,
  setActiveOfflineProfileKey: setActiveOfflineProfileKeyMock,
  summarizeOfflineSnapshot: vi.fn((snapshot) => ({
    itemCount: Object.keys(snapshot.items).length,
    readyItemCount: 1,
    errorItemCount: 0,
    trackCount: 1,
    readyTrackCount: 1,
    totalBytes: 1234,
  })),
  syncOfflineProfileToServiceWorker: syncOfflineProfileToServiceWorkerMock,
}));

vi.mock("@/contexts/use-offline-synchronization", () => ({
  useOfflineSynchronization: ({
    enqueue,
    transferAbortRef,
  }: {
    enqueue: <T>(fn: () => Promise<T>) => Promise<T>;
    transferAbortRef: { current: AbortController | null };
  }) => ({
    syncing: false,
    syncAll: () =>
      enqueue(async () => {
        const controller = {
          abort: abortOfflineTransferMock,
        } as unknown as AbortController;
        transferAbortRef.current = controller;
        try {
          await offlineSyncOperationMock();
        } finally {
          if (transferAbortRef.current === controller) {
            transferAbortRef.current = null;
          }
        }
      }),
  }),
}));

import { AuthContext, type AuthContextValue } from "@/contexts/auth-context";
import { OfflineProvider, useOffline } from "@/contexts/OfflineContext";

function createAuthValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: {
      id: 7,
      email: "listener@example.test",
      name: "Listener",
      role: "user",
    },
    loading: false,
    refetch: vi.fn(async () => ({
      id: 7,
      email: "listener@example.test",
      name: "Listener",
      role: "user",
    })),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

function OfflineProbe() {
  const offline = useOffline();
  return (
    <div>
      <div>{offline.summary.itemCount}</div>
      <div>{offline.getTrackState("entity-1")}</div>
      <button onClick={() => void offline.syncAll()}>sync</button>
      <button onClick={() => void offline.clearActiveProfile()}>clear</button>
    </div>
  );
}

describe("OfflineProvider", () => {
  beforeEach(() => {
    clearOfflineAssetsMock.mockClear();
    abortOfflineTransferMock.mockClear();
    hydrateOfflineProfileStateMock.mockClear();
    isOfflineSupportedMock.mockClear();
    saveOfflineSnapshotMock.mockClear();
    setActiveOfflineProfileKeyMock.mockClear();
    syncOfflineProfileToServiceWorkerMock.mockClear();
    offlineSyncOperationMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("hydrates the active profile and exposes ready offline state", async () => {
    render(
      <AuthContext.Provider value={createAuthValue()}>
        <OfflineProvider>
          <OfflineProbe />
        </OfflineProvider>
      </AuthContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("1")).toBeTruthy();
    });
    expect(screen.getByText("ready")).toBeTruthy();
    expect(setActiveOfflineProfileKeyMock).toHaveBeenCalledWith("profile-1");
    expect(syncOfflineProfileToServiceWorkerMock).toHaveBeenCalledWith(
      "profile-1",
    );
  });

  it("clears assets for the active profile when asked", async () => {
    render(
      <AuthContext.Provider value={createAuthValue()}>
        <OfflineProvider>
          <OfflineProbe />
        </OfflineProvider>
      </AuthContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("ready")).toBeTruthy();
    });

    screen.getByRole("button", { name: "clear" }).click();

    await waitFor(() => {
      expect(clearOfflineAssetsMock).toHaveBeenCalledWith("profile-1");
    });
  });

  it("aborts and waits for active offline work before clearing assets", async () => {
    let finishSync: (() => void) | undefined;
    offlineSyncOperationMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSync = resolve;
      }),
    );
    render(
      <AuthContext.Provider value={createAuthValue()}>
        <OfflineProvider>
          <OfflineProbe />
        </OfflineProvider>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "sync" }));
    await waitFor(() =>
      expect(offlineSyncOperationMock).toHaveBeenCalledOnce(),
    );
    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() =>
      expect(abortOfflineTransferMock).toHaveBeenCalledOnce(),
    );
    expect(clearOfflineAssetsMock).not.toHaveBeenCalled();

    await act(async () => finishSync!());
    await waitFor(() =>
      expect(clearOfflineAssetsMock).toHaveBeenCalledWith("profile-1"),
    );
  });
});
