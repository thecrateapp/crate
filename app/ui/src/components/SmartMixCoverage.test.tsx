import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, refetchMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  refetchMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/SmartMixTracks", () => ({
  SmartMixTracks: () => null,
}));

vi.mock("@/components/SmartMixActivity", () => ({
  SmartMixActivity: () => null,
}));

import { SmartMixCoverage } from "./SmartMixCoverage";

const status = {
  profileVersion: 1,
  analyzerVersion: "smart-mix-v1",
  totalTracks: 100,
  currentProfiles: 40,
  staleProfiles: 7,
  missingProfiles: 60,
  coveragePercent: 40,
  quality: {
    full: 35,
    partial: 5,
    legacy: 0,
    unavailable: 0,
  },
  processing: {
    pending: 3,
    active: 2,
    failed: 1,
    exhausted: 4,
    completed: 34,
  },
  refreshedAt: "2026-07-30T10:00:00Z",
  controlState: "running",
  activeTask: {
    id: "task-active",
    status: "running",
    createdAt: "2026-07-30T10:00:00Z",
    updatedAt: "2026-07-30T10:01:00Z",
  },
};

describe("SmartMixCoverage", () => {
  beforeEach(() => {
    apiMock.mockReset();
    refetchMock.mockReset();
    useApiMock.mockReturnValue({
      data: status,
      loading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  it("renders coverage, profile quality and the active backfill controls", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({
      taskId: "task-active",
      status: "paused",
      deduplicated: false,
    });

    render(<SmartMixCoverage />);

    const summary = screen
      .getByText("Smart Mix profiles")
      .closest(".space-y-1");
    expect(summary).toBeInTheDocument();
    expect(summary?.querySelector("svg")).toBeNull();
    expect(screen.getByText("40% coverage")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Smart Mix profile coverage" }),
    ).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("smart-mix-v1")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: "Pause backfill" })
        .querySelector("svg"),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Cancel backfill" })
        .querySelector("svg"),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Pause backfill" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/smart-mix/backfill/pause",
        "POST",
      );
    });
    expect(refetchMock).toHaveBeenCalled();
  });

  it("counts full and partial over current profiles only", () => {
    useApiMock.mockReturnValue({
      data: {
        ...status,
        currentQuality: { full: 191, partial: 538, legacy: 0 },
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(<SmartMixCoverage />);

    expect(screen.getByText("191")).toBeInTheDocument();
    expect(screen.getByText("538")).toBeInTheDocument();
    expect(screen.queryByText("35")).toBeNull();
  });

  it("starts a bounded backfill when coverage is idle", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: { ...status, controlState: "idle", activeTask: null },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    apiMock.mockResolvedValue({
      taskId: "task-new",
      status: "queued",
      deduplicated: false,
    });

    render(<SmartMixCoverage />);

    await user.click(screen.getByRole("button", { name: "Start backfill" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/smart-mix/backfill",
        "POST",
        { batchSize: 25, maxAttempts: 3 },
      );
    });
    expect(refetchMock).toHaveBeenCalled();
  });
});
