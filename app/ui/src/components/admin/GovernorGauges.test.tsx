import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useApi: vi.fn() }));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

import {
  GovernorGauges,
  ResourceGovernorMonitor,
  type GovernorSurface,
} from "./GovernorGauges";

const healthySurface: GovernorSurface = {
  available: true,
  stale: false,
  sampled_at: "2026-10-22T09:30:00Z",
  sampled_by: "crate-worker",
  enabled: true,
  allowed: true,
  defer_seconds: 300,
  gauges: [
    {
      id: "load_ratio",
      label: "Load ratio",
      value: 0.46,
      unit: "",
      limit: 0.85,
      scale: 1.2,
      over: false,
    },
    {
      id: "iowait_percent",
      label: "I/O wait",
      value: 6.2,
      unit: "%",
      limit: 25,
      scale: 40,
      over: false,
    },
    {
      id: "swap_used_percent",
      label: "Swap used",
      value: 18,
      unit: "%",
      limit: 30,
      scale: 60,
      over: false,
    },
    {
      id: "active_users",
      label: "Listeners",
      value: 4,
      unit: "",
      limit: 10,
      scale: 14,
      over: false,
    },
    {
      id: "active_streams",
      label: "Streams",
      value: 3,
      unit: "",
      limit: 10,
      scale: 14,
      over: false,
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  mocks.useApi.mockReset();
});

describe("GovernorGauges", () => {
  it("shows the worker decision and all five values against configured limits", () => {
    render(<GovernorGauges surface={healthySurface} />);

    const panel = screen.getByRole("region", { name: "Resource governor" });
    expect(panel).toHaveClass("border-t", "pt-5");
    expect(panel).not.toHaveClass("rounded-md", "bg-raised-surface");
    expect(panel).toHaveTextContent("ALLOWED · BACKGROUND WORK RUNS");
    expect(panel).toHaveTextContent("MAX 0.85");
    expect(panel).toHaveTextContent("MAX 25%");
    expect(panel).toHaveTextContent("MAX 30%");
    expect(panel).toHaveTextContent("MAX 10");
    expect(screen.getAllByRole("meter")).toHaveLength(5);
    expect(
      screen.getByRole("meter", { name: /Load ratio: 0.46/ }),
    ).toHaveAttribute("aria-valuenow", "0.46");
  });

  it("marks stale samples and displays a deferral reason", () => {
    render(
      <GovernorGauges
        surface={{
          ...healthySurface,
          stale: true,
          allowed: false,
          reason: "load 0.93>0.85",
          defer_seconds: 301,
          gauges: healthySurface.gauges.map((gauge) =>
            gauge.id === "load_ratio" ? { ...gauge, over: true } : gauge,
          ),
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "DEFERRING GOVERNED WORK · RETRY IN 6M · STALE",
    );
    expect(screen.getByText("load 0.93>0.85")).toBeInTheDocument();
  });

  it("shows retries in the status label and keeps the empty state concise", () => {
    render(<GovernorGauges surface={null} error='{"detail":"Not Found"}' />);

    expect(screen.getByText("No worker sample is available yet.")).toHaveClass(
      "text-sm",
      "leading-relaxed",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "RETRYING FOR WORKER SAMPLE",
    );
    expect(
      screen.queryByText(
        "Could not load a worker sample. Retrying automatically.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Not Found/)).not.toBeInTheDocument();
  });

  it("keeps the last available sample visible while retrying", () => {
    render(
      <GovernorGauges surface={healthySurface} error="Network unavailable" />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "RETRYING · USING LAST SAMPLE",
    );
    expect(screen.getAllByRole("meter")).toHaveLength(5);
  });

  it("refreshes the persisted sample every fifteen seconds", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    mocks.useApi.mockReturnValue({
      data: healthySurface,
      loading: false,
      error: null,
      refetch,
    });

    const { unmount } = render(<ResourceGovernorMonitor />);
    expect(mocks.useApi).toHaveBeenCalledWith("/api/admin/governor");

    act(() => vi.advanceTimersByTime(15_000));
    expect(refetch).toHaveBeenCalledTimes(1);

    unmount();
    act(() => vi.advanceTimersByTime(30_000));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
