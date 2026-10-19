import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

import {
  ACTIVITY_POLL_MS,
  COUNTS_REFRESH_EVERY,
  SmartMixActivity,
  formatEta,
} from "./SmartMixActivity";

const snapshot = {
  queued: 18,
  running: [
    {
      taskId: "run-1",
      trackId: 99,
      title: "Trodden Flesh",
      artist: "Black Curse",
      elapsedMs: 4_100,
    },
  ],
  recent: [
    {
      taskId: "done-1",
      trackId: 98,
      title: "Spleen Girt With Serpent",
      artist: "Black Curse",
      outcome: "published",
      error: null,
      durationMs: 5_700,
    },
    {
      taskId: "bad-1",
      trackId: 97,
      title: "Broken",
      artist: null,
      outcome: "failed",
      error: "decoder exploded",
      durationMs: 300,
    },
  ],
  tracksPerMinute: 16.5,
  rateWindowMinutes: 10,
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SmartMixActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockReset();
    apiMock.mockResolvedValue(snapshot);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the track being analyzed, the rate, the queue and the ETA", async () => {
    render(<SmartMixActivity live remaining={330} onRefreshCounts={vi.fn()} />);
    await flush();

    expect(screen.getByText("Analyzing now")).toBeInTheDocument();
    expect(screen.getByText("Trodden Flesh · Black Curse")).toBeInTheDocument();
    expect(screen.getByText("4.1 s")).toBeInTheDocument();
    expect(screen.getByText("16.5 tracks/min")).toBeInTheDocument();
    expect(screen.getByText("18 queued")).toBeInTheDocument();
    expect(screen.getByText("~20 min left")).toBeInTheDocument();
    expect(screen.getByText("failed").closest("li")).toHaveAttribute(
      "title",
      "decoder exploded",
    );
  });

  it("polls while the backfill runs and refreshes the counts periodically", async () => {
    const refreshCounts = vi.fn();
    render(
      <SmartMixActivity live remaining={330} onRefreshCounts={refreshCounts} />,
    );
    await flush();

    for (let tick = 1; tick < COUNTS_REFRESH_EVERY; tick += 1) {
      await act(async () => {
        vi.advanceTimersByTime(ACTIVITY_POLL_MS);
      });
      await flush();
    }

    expect(apiMock).toHaveBeenCalledTimes(COUNTS_REFRESH_EVERY);
    expect(refreshCounts).toHaveBeenCalledTimes(1);
  });

  it("loads once and stops polling when the backfill is idle", async () => {
    render(
      <SmartMixActivity
        live={false}
        remaining={330}
        onRefreshCounts={vi.fn()}
      />,
    );
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(ACTIVITY_POLL_MS * 3);
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/min left/)).toBeNull();
  });

  it("formats the remaining time in minutes and hours", () => {
    expect(formatEta(330, 16.5)).toBe("~20 min left");
    expect(formatEta(120_000, 16.5)).toBe("~121 h 13 min left");
    expect(formatEta(0, 16.5)).toBeNull();
    expect(formatEta(10, 0)).toBeNull();
  });
});
