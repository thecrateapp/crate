import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlaybackHealth, type PlaybackQoeSummary } from "./PlaybackHealth";

function qoe(overrides: Partial<PlaybackQoeSummary> = {}): PlaybackQoeSummary {
  return {
    availability: "available",
    reason: null,
    caveats: [],
    window_minutes: 15,
    minimum_attempts: 20,
    intents: 52,
    attempts: 50,
    started: 48,
    failed: 2,
    cancelled: 1,
    start_success_ratio: 0.96,
    stall_ratio: 0.004,
    startup_avg_ms: 420,
    stalls: 3,
    recoveries: 1,
    telemetry: {
      accepted: 180,
      unverified: 0,
      rate_limited: 0,
      duplicates: 4,
      client_losses: 0,
      legacy_batches: 0,
      current_batches: 20,
    },
    ...overrides,
  };
}

function tile(label: string) {
  return screen.getByText(label, { exact: true }).parentElement!;
}

describe("PlaybackHealth", () => {
  it("shows start success, stall time and startup for a current sample", () => {
    render(<PlaybackHealth qoe={qoe()} />);

    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(within(tile("Start success")).getByText("96%")).toBeInTheDocument();
    expect(within(tile("Stall time")).getByText("0.40%")).toBeInTheDocument();
    expect(within(tile("Startup")).getByText("420ms")).toBeInTheDocument();
    expect(screen.getByText("48 of 50 attempts started")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Telemetry delivery" }))
        .getByText("4 duplicates"),
    ).toBeInTheDocument();
  });

  it("hides ratios while the sample is too small", () => {
    render(
      <PlaybackHealth
        qoe={qoe({
          availability: "insufficient_sample",
          attempts: 6,
          started: 6,
          failed: 0,
          start_success_ratio: 1,
        })}
      />,
    );

    expect(screen.getByText("Small sample")).toBeInTheDocument();
    expect(within(tile("Start success")).getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText(/Fewer than 20 play attempts in this window/),
    ).toBeInTheDocument();
  });

  it("shows missing readings as missing, never as zero", () => {
    render(
      <PlaybackHealth
        qoe={qoe({
          availability: "partial",
          caveats: ["legacy_clients", "client_losses"],
          stall_ratio: null,
          startup_avg_ms: null,
          stalls: null,
          telemetry: { accepted: null, client_losses: 3 },
        })}
      />,
    );

    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(within(tile("Stall time")).getByText("—")).toBeInTheDocument();
    expect(within(tile("Startup")).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("— events accepted")).toBeInTheDocument();
    expect(
      screen.getByText("Older Listen clients report startups and stalls only."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Clients reported events they could not deliver."),
    ).toBeInTheDocument();
  });

  it("marks stale readings and warns on a poor start success ratio", () => {
    render(
      <PlaybackHealth
        qoe={qoe({ availability: "stale", start_success_ratio: 0.7 })}
      />,
    );

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(within(tile("Start success")).getByText("70%")).toHaveClass(
      "text-state-warning-text",
    );
  });

  it.each([
    [undefined, "Unavailable", /readings are unavailable/],
    [
      qoe({ availability: "unavailable", reason: "metric_source_unavailable" }),
      "Unavailable",
      /readings are unavailable/,
    ],
    [
      qoe({ availability: "empty", reason: "no_current_clients" }),
      "No reports",
      /No current Listen client reported playback/,
    ],
  ])("explains the %#th state without drawing tiles", (input, badge, text) => {
    render(<PlaybackHealth qoe={input} />);

    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText("Start success")).not.toBeInTheDocument();
  });
});
