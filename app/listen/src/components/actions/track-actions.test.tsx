import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.hoisted(() => vi.fn());
const shareMock = vi.hoisted(() => vi.fn());

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

describe("useTrackActionEntries", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    shareMock.mockReset();
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: shareMock.mockResolvedValue(undefined),
    });
  });

  it("shares tracks through the public preview URL", async () => {
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
      shareAction.type === "label"
    ) {
      throw new Error("Share action missing");
    }

    await act(async () => {
      await shareAction.onSelect();
    });

    expect(shareMock).toHaveBeenCalledWith({
      title: "High Vis - Talk for Hours",
      text: "High Vis - Talk for Hours",
      url: `${window.location.origin}/share/track/track-entity-12/talk-for-hours`,
    });
  });
});
