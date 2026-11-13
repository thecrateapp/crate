import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { MoodBrowseSection } from "./ExploreLandingSections";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));

describe("MoodBrowseSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(api).mockReset();
  });

  it("plays a mood without creating its own AudioContext", async () => {
    const audioContext = vi.fn();
    vi.stubGlobal("AudioContext", audioContext);
    vi.mocked(api).mockResolvedValue({
      tracks: [
        {
          id: 7,
          title: "Marea",
          artist: "Costa Norte",
          album: "Luz",
          path: "/music/marea.flac",
        },
      ],
    });
    const playAll = vi.fn();

    renderWithListenProviders(
      <MoodBrowseSection moods={[{ name: "chill", track_count: 12 }]} />,
      { playerActions: { playAll } },
    );
    fireEvent.click(screen.getByRole("button", { name: /chill/i }));

    await waitFor(() => expect(playAll).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith("/api/browse/mood/chill?limit=50");
    expect(audioContext).not.toHaveBeenCalled();
    expect(
      (window as unknown as Record<string, unknown>).__crateAudioCtx,
    ).toBeUndefined();
  });
});
