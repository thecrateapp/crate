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

import { SmartMixCoverage } from "./SmartMixCoverage";

const status = {
  profileVersion: 1,
  analyzerVersion: "smart-mix-v1",
  totalTracks: 100,
  currentProfiles: 40,
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
    completed: 34,
  },
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

    expect(screen.getByText("40% coverage")).toBeInTheDocument();
    expect(screen.getByText("smart-mix-v1")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pause backfill" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/smart-mix/backfill/pause",
        "POST",
      );
    });
    expect(refetchMock).toHaveBeenCalled();
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
