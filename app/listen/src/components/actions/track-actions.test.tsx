import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({
    play: vi.fn(),
    playAll: vi.fn(),
    addToQueue: vi.fn(),
    playNext: vi.fn(),
  }),
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(),
  }),
}));

vi.mock("@/contexts/OfflineContext", () => ({
  useOffline: () => ({
    supported: true,
    getTrackState: () => "idle",
    toggleTrackOffline: vi.fn(),
  }),
}));

vi.mock("@/lib/radio", () => ({
  fetchTrackRadio: vi.fn(),
}));

import { useTrackActionEntries } from "@/components/actions/track-actions";
import { I18nProvider, type ListenLocale } from "@/i18n";
import { fetchTrackRadio } from "@/lib/radio";
import { SHARE_REQUEST_EVENT, type SharePayload } from "@/lib/social-share";

function i18nWrapper(locale: ListenLocale = "es") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <I18nProvider initialLocale={locale}>{children}</I18nProvider>;
  };
}

describe("useTrackActionEntries", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.mocked(fetchTrackRadio).mockReset();
  });

  it("shares tracks through Crate's share sheet with the public preview URL", async () => {
    let sharePayload: SharePayload | null = null;
    const onShare = (event: Event) => {
      sharePayload = (event as CustomEvent<SharePayload>).detail;
    };
    window.addEventListener(SHARE_REQUEST_EVENT, onShare);
    const { result } = renderHook(() =>
      useTrackActionEntries({
        track: {
          id: 12,
          entity_uid: "track-entity-12",
          title: "Talk for Hours",
          artist: "High Vis",
        },
      }),
    );

    const shareAction = result.current.find((entry) => entry.key === "share");
    if (
      !shareAction ||
      shareAction.type === "divider" ||
      shareAction.type === "label" ||
      shareAction.type === "disclosure"
    ) {
      throw new Error("Share action missing");
    }

    await act(async () => {
      await shareAction.onSelect();
    });
    window.removeEventListener(SHARE_REQUEST_EVENT, onShare);

    expect(sharePayload).toEqual({
      kind: "track",
      title: "Talk for Hours",
      subtitle: "High Vis",
      url: `${window.location.origin}/share/track/track-entity-12/talk-for-hours`,
    });
  });

  it("keeps share enabled when player snapshots only expose a UUID id", () => {
    const { result } = renderHook(() =>
      useTrackActionEntries({
        track: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          title: "Talk for Hours",
          artist: "High Vis",
        },
      }),
    );

    const shareAction = result.current.find((entry) => entry.key === "share");
    if (
      !shareAction ||
      shareAction.type === "divider" ||
      shareAction.type === "label"
    ) {
      throw new Error("Share action missing");
    }

    expect(shareAction.disabled).toBe(false);
  });

  it("keeps track identity actions enabled when snapshots only expose a numeric id", () => {
    const { result } = renderHook(() =>
      useTrackActionEntries({
        track: {
          id: 12,
          title: "Talk for Hours",
          artist: "High Vis",
        },
      }),
    );

    for (const key of ["like", "radio", "offline", "download"]) {
      const action = result.current.find((entry) => entry.key === key);
      if (!action || action.type === "divider" || action.type === "label") {
        throw new Error(`${key} action missing`);
      }
      expect(action.disabled).toBe(false);
    }
  });

  it("uses global refs for remote track radio without enabling local-only actions", async () => {
    vi.mocked(fetchTrackRadio).mockResolvedValue({
      tracks: [],
      source: { type: "radio", name: "Remote Radio" },
    });
    const { result } = renderHook(() =>
      useTrackActionEntries({
        track: {
          id: "11111111-1111-4111-8111-111111111111",
          global_track_uid: "11111111-1111-4111-8111-111111111111",
          title: "Talk for Hours",
          artist: "High Vis",
        },
      }),
    );

    const byKey = (key: string) => {
      const entry = result.current.find((item) => item.key === key);
      if (
        !entry ||
        entry.type === "divider" ||
        entry.type === "label" ||
        entry.type === "disclosure"
      ) {
        throw new Error(`${key} action missing`);
      }
      return entry;
    };

    expect(byKey("like").disabled).toBe(true);
    expect(byKey("offline").disabled).toBe(true);
    expect(byKey("download").disabled).toBe(true);
    expect(byKey("radio").disabled).toBe(false);
    expect(byKey("share").disabled).toBe(false);

    await act(async () => {
      await byKey("radio").onSelect();
    });

    expect(fetchTrackRadio).toHaveBeenCalledWith({
      libraryTrackId: null,
      globalTrackUid: "11111111-1111-4111-8111-111111111111",
      entityUid: null,
      path: undefined,
      title: "Talk for Hours",
    });
  });

  it("localizes track action labels", () => {
    const { result } = renderHook(
      () =>
        useTrackActionEntries({
          track: {
            id: 12,
            entity_uid: "track-entity-12",
            title: "Talk for Hours",
            artist: "High Vis",
          },
          playlistOptions: [{ id: 1, name: "Favorites" }],
          onCreatePlaylist: vi.fn(),
          onAddToPlaylist: vi.fn(),
        }),
      { wrapper: i18nWrapper("es") },
    );

    const labels = result.current
      .filter((entry) => entry.type !== "divider")
      .map((entry) => entry.label);

    expect(labels).toEqual(
      expect.arrayContaining([
        "Reproducir ahora",
        "Reproducir a continuación",
        "Añadir a la cola",
        "Me gusta",
        "Iniciar radio de canción",
        "Compartir canción",
        "Descargar canción",
        "Playlists",
        "Añadir a una playlist nueva",
        "Añadir a Favorites",
      ]),
    );
  });
});
