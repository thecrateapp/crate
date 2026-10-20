import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { TrackInfo } from "@/lib/track-info";
import { InfoTabView } from "./InfoTabView";
const blank: TrackInfo = {
  title: "Mixed Case Track",
  artist: "The Artist",
  album: "The Album",
  format: null,
  bitrate: null,
  sample_rate: null,
  bit_depth: null,
  bpm: null,
  audio_key: null,
  audio_scale: null,
  energy: null,
  danceability: null,
  valence: null,
  acousticness: null,
  instrumentalness: null,
  loudness: null,
  dynamic_range: null,
  mood_json: null,
  lastfm_listeners: null,
  lastfm_playcount: null,
  popularity: null,
  rating: null,
  bliss_signature: null,
};
const track = { id: "one", title: "Track", artist: "Artist", album: "Album" };
it("preserves real zero readings, absent analysis and injected identity actions", () => {
  const artist = vi.fn(),
    album = vi.fn();
  const { container } = renderWithListenProviders(
    <InfoTabView
      info={{
        ...blank,
        energy: 0,
        lastfm_listeners: 0,
        lastfm_playcount: 0,
        popularity: 0,
      }}
      currentTrack={track}
      loading={false}
      onOpenArtist={artist}
      onOpenAlbum={album}
    />,
  );
  expect(screen.getByRole("heading", { name: "Audio Profile" })).toHaveClass(
    "text-accent-action-hi",
  );
  expect(screen.getByRole("meter", { name: "Energy" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  expect(
    screen.queryByRole("meter", { name: "Danceability" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Reach" })).toHaveTextContent("0");
  expect(
    screen.queryByText(
      "No popularity signals are available for this track yet.",
    ),
  ).not.toBeInTheDocument();
  expect(
    container.querySelector("[data-quality-tier]"),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Open artist The Artist" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open album The Album" }));
  expect(artist).toHaveBeenCalledOnce();
  expect(album).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("heading", { name: "Mixed Case Track" }),
  ).toBeInTheDocument();
});
it("distinguishes loading, failed and absent info", () => {
  const retry = vi.fn();
  const { rerender, container } = renderWithListenProviders(
    <InfoTabView info={null} currentTrack={track} loading />,
  );
  expect(
    container.querySelector(".crate-loading-section-full"),
  ).toBeInTheDocument();
  rerender(
    <InfoTabView
      info={null}
      currentTrack={track}
      loading={false}
      error
      onRetry={retry}
    />,
  );
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  rerender(<InfoTabView info={null} currentTrack={track} loading={false} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "No track info available",
  );
});
it("uses the exact player badge for playback and keeps original quality in Source", () => {
  renderWithListenProviders(
    <InfoTabView
      info={{ ...blank, format: "flac", bit_depth: 24, sample_rate: 96000 }}
      currentTrack={track}
      loading={false}
      playbackQuality={{
        trackId: track.id,
        badge: { label: "AAC 192", detail: "192 kbps", tier: "standard" },
        origin: "stream",
        source: { format: "flac", bitDepth: 24, sampleRate: 96000 },
      }}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Mixed Case Track" }),
  ).toHaveTextContent("AAC 192");
  expect(
    screen.getByRole("region", { name: "Source & Dynamics" }),
  ).toHaveTextContent("Hi-Res 24/96");
});
