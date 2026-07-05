import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { StatsDashboard } from "@/components/stats/stats-model";

import { Stats } from "./Stats";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

const mockUseApi = vi.mocked(useApi);

describe("Stats page", () => {
  beforeEach(() => {
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("localizes the main stats chrome", () => {
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    expect(screen.getByText("ADN de escucha")).toBeInTheDocument();
    expect(screen.getByText("Tu sonido")).toBeInTheDocument();
    expect(screen.getByText("descifrado")).toBeInTheDocument();
    expect(screen.getByText("Tu ADN")).toBeInTheDocument();
    expect(screen.getByText("Pulso Crate")).toBeInTheDocument();
    expect(
      screen.getByText("Tus estadísticas esperan una señal"),
    ).toBeInTheDocument();
  });

  it("localizes data-backed stats panels", () => {
    const dashboard: StatsDashboard = {
      window: "30d",
      subject: {
        kind: "user",
        username: "listener",
        display_name: "Listener",
      },
      overview: {
        window: "30d",
        play_count: 12,
        complete_play_count: 10,
        skip_count: 2,
        minutes_listened: 64,
        active_days: 4,
        skip_rate: 0.16,
        top_artist: {
          artist_name: "Fugazi",
          play_count: 8,
          minutes_listened: 42,
        },
      },
      trends: {
        window: "30d",
        points: [
          {
            day: "2026-07-01",
            play_count: 6,
            complete_play_count: 5,
            skip_count: 1,
            minutes_listened: 32,
          },
        ],
      },
      top_tracks: {
        window: "30d",
        items: [
          {
            track_id: 1,
            track_path: "/music/fugazi/waiting-room.flac",
            title: "Waiting Room",
            artist: "Fugazi",
            album: "13 Songs",
            energy: 0.72,
            danceability: 0.42,
            valence: 0.34,
            play_count: 6,
            complete_play_count: 5,
            minutes_listened: 18,
          },
        ],
      },
      top_artists: {
        window: "30d",
        items: [
          {
            artist_name: "Fugazi",
            play_count: 8,
            complete_play_count: 7,
            minutes_listened: 42,
          },
        ],
      },
      top_albums: {
        window: "30d",
        items: [
          {
            artist: "Fugazi",
            album: "13 Songs",
            play_count: 6,
            complete_play_count: 5,
            minutes_listened: 18,
          },
        ],
      },
      top_genres: {
        window: "30d",
        items: [],
      },
      replay: {
        window: "30d",
        title: "Replay",
        subtitle: "Snapshot",
        track_count: 0,
        minutes_listened: 0,
        items: [],
      },
      viewer_affinity: {
        affinity_score: 82,
        affinity_band: "very_high",
        affinity_reasons: ["Fugazi"],
      },
    };

    mockUseApi.mockReturnValue({
      data: dashboard,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Stats />, {
      route: "/users/listener/stats",
      path: "/users/:username/stats",
      locale: "es",
    });

    expect(screen.getByText("Coincidencia de oyente")).toBeInTheDocument();
    expect(screen.getByText("82% de afinidad")).toBeInTheDocument();
    expect(screen.getByText("Fugazi lideró esta ventana")).toBeInTheDocument();
    expect(screen.getAllByText(/1 jul/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Señal 01")).toBeInTheDocument();
    expect(screen.getByText("Tu perfil sonoro")).toBeInTheDocument();
    expect(screen.getByText("Energía")).toBeInTheDocument();
    expect(screen.getByText("Movimiento")).toBeInTheDocument();
    expect(screen.getByText("Luminosidad")).toBeInTheDocument();
    expect(screen.getByText("BPM medio")).toBeInTheDocument();
    expect(screen.getByText("Tasa de saltos")).toBeInTheDocument();
    expect(
      screen.getByText("La señal de géneros aparecerá aquí."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tu replay aparecerá cuando escuches un poco más."),
    ).toBeInTheDocument();
  });
});
