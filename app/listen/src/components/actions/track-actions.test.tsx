import { act, renderHook } from "@testing-library/react";
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
import { SHARE_REQUEST_EVENT, type SharePayload } from "@/lib/social-share";

describe("useTrackActionEntries", () => {
  beforeEach(() => {
    navigateMock.mockReset();
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
});
