import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock, refetchMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { PlaybackDelivery } from "./PlaybackDelivery";

const delivery = {
  stats: {
    tracks: 100,
    lossless_tracks: 80,
    hires_tracks: 12,
    variants: 54,
    variant_tracks: 42,
    ready: 51,
    pending: 3,
    pending_active: 2,
    pending_unassigned: 1,
    pending_stale: 0,
    running: 1,
    failed: 0,
    missing: 29,
    ready_tracks: 41,
    cached_bytes: 500_000_000,
    ready_source_bytes: 800_000_000,
    estimated_saved_bytes: 300_000_000,
    coverage_percent: 51.25,
    avg_prepare_seconds: 1.6,
  },
  runtime: { active: 1, limit: 4, slots: [] },
  recent_variants: [
    {
      id: "variant-1",
      track_id: 18,
      preset: "streaming",
      status: "ready",
      delivery_format: "AAC",
      delivery_codec: "aac",
      delivery_bitrate: 256,
      source_format: "FLAC",
      source_bitrate: 1411,
      source_size: 40_000_000,
      bytes: 8_000_000,
      task_id: "task-1",
      task_status: "completed",
      title: "Bright Lights",
      artist: "The Killers",
      album: "Hot Fuss",
      updated_at: "2026-10-22T10:00:00Z",
      completed_at: "2026-10-22T10:00:00Z",
      error: null,
    },
  ],
};

describe("PlaybackDelivery", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    refetchMock.mockReset();
    useApiMock.mockReturnValue({
      data: delivery,
      loading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  it("shows delivery coverage, worker capacity and recent variants on its own page", () => {
    renderWithAdminProviders(<PlaybackDelivery />, { route: "/playback" });

    expect(
      screen.getByRole("heading", { level: 1, name: "Playback Delivery" }),
    ).toHaveClass("font-display", "font-extrabold");
    const actions = screen.getByRole("group", {
      name: "Playback delivery actions",
    });
    const refresh = within(actions).getByRole("button", { name: "Refresh" });
    expect(refresh).toHaveAttribute("data-size", "icon-lg");
    expect(refresh).toHaveAttribute("data-variant", "ghost");
    expect(refresh).not.toHaveAttribute("title");
    expect(screen.getByText("51.25%")).toBeVisible();
    expect(screen.getByText("41 / 80 tracks")).toBeVisible();
    expect(
      screen.getByRole("meter", { name: "Transcode slots" }),
    ).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("1 running")).toBeVisible();

    const variants = screen.getByRole("heading", { name: "Recent variants" })
      .parentElement?.parentElement;
    expect(variants).not.toBeNull();
    expect(
      within(variants!).getByText("The Killers · Bright Lights"),
    ).toBeVisible();
    expect(
      within(variants!).getByText("Hot Fuss · streaming · FLAC → AAC 256k"),
    ).toBeVisible();
    expect(within(variants!).getByText("ready")).toBeVisible();
  });

  it("does not invent transcode capacity when runtime data is missing", () => {
    useApiMock.mockReturnValue({
      data: { ...delivery, runtime: { active: undefined, limit: undefined } },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    renderWithAdminProviders(<PlaybackDelivery />, { route: "/playback" });

    expect(
      screen.queryByRole("meter", { name: "Transcode slots" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("n/a")).toBeVisible();
  });

  it("uses the semantic danger tone for failed playback variants", () => {
    useApiMock.mockReturnValue({
      data: {
        ...delivery,
        recent_variants: [{ ...delivery.recent_variants[0], status: "failed" }],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    renderWithAdminProviders(<PlaybackDelivery />, { route: "/playback" });

    expect(
      screen.getByText("failed").closest('[data-slot="info-badge"]'),
    ).toHaveAttribute("data-tone", "danger");
  });

  it("supports cold-error recovery and refresh without discarding the last sample", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: null,
      loading: false,
      error: "network unavailable",
      refetch: refetchMock,
    });
    const view = renderWithAdminProviders(<PlaybackDelivery />, {
      route: "/playback",
    });

    const coldError = screen.getByRole("alert");
    expect(coldError).toHaveTextContent("Could not load playback delivery.");
    await user.click(within(coldError).getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalledOnce();

    useApiMock.mockReturnValue({
      data: delivery,
      loading: false,
      error: "network unavailable",
      refetch: refetchMock,
    });
    view.rerender(<PlaybackDelivery />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Showing the last successful sample.",
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("The Killers · Bright Lights")).toBeVisible();
  });
});
