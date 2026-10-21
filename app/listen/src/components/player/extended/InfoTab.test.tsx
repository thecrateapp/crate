import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({
    currentTrack: {
      id: "track-1",
      entityUid: "track-1",
      title: "Track One",
      artist: "Artist One",
      album: "Album One",
      artistId: 1,
      albumId: 1,
      albumCover: "/api/albums/1/cover",
    },
  }),
}));

vi.mock("@/hooks/use-track-info", () => ({
  useTrackInfo: () => ({
    loading: false,
    info: {
      title: "Track One",
      artist: "Artist One",
      album: "Album One",
      format: "flac",
      bitrate: 1_411,
      sample_rate: 96_000,
      bit_depth: 24,
      bpm: 128,
      audio_key: "C",
      audio_scale: "minor",
      energy: 0.8,
      danceability: 0.7,
      valence: 0.6,
      acousticness: 0.2,
      instrumentalness: 0.4,
      loudness: -8.4,
      dynamic_range: 9.2,
      mood_json: { focused: 0.8 },
      lastfm_listeners: 1_000,
      lastfm_playcount: 2_000,
      popularity: 75,
      rating: 4,
      bliss_signature: { texture: 0.7, motion: 0.6, density: 0.8 },
    },
  }),
}));

vi.mock("@/components/artwork/CrateImage", () => ({
  CrateImage: ({
    onArtworkStateChange: _state,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    onArtworkStateChange?: unknown;
  }) => {
    void _state;
    return <img {...props} />;
  },
}));

vi.mock("@/lib/palette", () => ({
  extractPalette: vi.fn(async () => [
    [0.1, 0.2, 0.3],
    [0.3, 0.4, 0.5],
    [0.5, 0.6, 0.7],
  ]),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));

import { InfoTab } from "./InfoTab";

describe("InfoTab", () => {
  it("uses canonical analysis, source quality and single dynamics readings", async () => {
    const { container } = render(<InfoTab />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Track One" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("meter", { name: "player.info.metric.energy" }),
    ).toHaveAttribute("aria-valuenow", "0.8");
    expect(
      container.querySelectorAll('[data-slot="instrument-panel"]').length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelector('[data-quality-tier="hi-res"]'),
    ).toHaveTextContent("Hi-Res 24/96");
    expect(screen.getAllByText("-8.4")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Track One" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle("Focused · 80%").closest(".genre-pill"),
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("rgba(");
    expect(container.innerHTML).not.toContain("border-white");
    expect(container.innerHTML).not.toContain("text-white");
  });
});
