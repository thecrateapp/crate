import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const { toastMock } = vi.hoisted(() => ({
  toastMock: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: toastMock,
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
  backfillSettings: {
    batchSize: 25,
    maxAttempts: 3,
    nightWindow: { start: "01:00", end: "08:00", timezone: "Europe/Madrid" },
    nightConcurrency: 8,
    dayConcurrency: 4,
  },
  backfillLimit: { window: "day", limit: 4 },
};

const defaultRequest = {
  batchSize: 25,
  maxAttempts: 3,
  nightWindow: { start: "01:00", end: "08:00", timezone: "Europe/Madrid" },
  nightConcurrency: 8,
  dayConcurrency: 4,
};

describe("SmartMixCoverage", () => {
  beforeEach(() => {
    apiMock.mockReset();
    refetchMock.mockReset();
    toastMock.error.mockReset();
    toastMock.success.mockReset();
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
        defaultRequest,
      );
    });
    expect(refetchMock).toHaveBeenCalled();
  });

  it("shows the active window and how many analyses it keeps in flight", () => {
    useApiMock.mockReturnValue({
      data: { ...status, backfillLimit: { window: "night", limit: 8 } },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    const { unmount } = render(<SmartMixCoverage />);

    expect(screen.getByText("Night window · 8 in flight")).toBeInTheDocument();
    expect(
      screen.getByText(
        "01:00 to 08:00 Europe/Madrid: 8 analyses in flight. Rest of the day: 4.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Night start")).toHaveValue("01:00");
    expect(screen.getByLabelText("Night end")).toHaveValue("08:00");
    expect(screen.getByLabelText("Timezone")).toHaveValue("Europe/Madrid");
    expect(screen.getByLabelText("Night in flight")).toHaveValue(8);
    expect(screen.getByLabelText("Day in flight")).toHaveValue(4);
    unmount();

    useApiMock.mockReturnValue({
      data: status,
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    render(<SmartMixCoverage />);

    expect(screen.getByText("Day · 4 in flight")).toBeInTheDocument();
  });

  it("starts the backfill with the edited night window", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: { ...status, controlState: "idle", activeTask: null },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    apiMock.mockResolvedValue({ taskId: "task-new", status: "queued" });

    render(<SmartMixCoverage />);

    fireEvent.change(screen.getByLabelText("Night start"), {
      target: { value: "23:30" },
    });
    fireEvent.change(screen.getByLabelText("Night end"), {
      target: { value: "07:00" },
    });
    await user.clear(screen.getByLabelText("Timezone"));
    await user.type(screen.getByLabelText("Timezone"), "Europe/Lisbon");
    await user.clear(screen.getByLabelText("Night in flight"));
    await user.type(screen.getByLabelText("Night in flight"), "6");
    await user.clear(screen.getByLabelText("Day in flight"));
    await user.type(screen.getByLabelText("Day in flight"), "2");
    expect(
      screen.queryByRole("button", { name: "Apply settings" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start backfill" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/smart-mix/backfill",
        "POST",
        {
          ...defaultRequest,
          nightWindow: {
            start: "23:30",
            end: "07:00",
            timezone: "Europe/Lisbon",
          },
          nightConcurrency: 6,
          dayConcurrency: 2,
        },
      );
    });
  });

  it("applies new settings to a running backfill", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({
      taskId: "task-active",
      status: "already_running",
      deduplicated: true,
    });

    render(<SmartMixCoverage />);

    await user.clear(screen.getByLabelText("Day in flight"));
    await user.type(screen.getByLabelText("Day in flight"), "3");
    await user.click(screen.getByRole("button", { name: "Apply settings" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/smart-mix/backfill",
        "POST",
        { ...defaultRequest, dayConcurrency: 3 },
      );
    });
    expect(toastMock.success).toHaveBeenCalledWith(
      "Smart Mix backfill settings applied",
    );
    expect(refetchMock).toHaveBeenCalled();
  });

  it("still starts against an API without the night window", async () => {
    const user = userEvent.setup();
    const legacyStatus: Record<string, unknown> = {
      ...status,
      controlState: "idle",
      activeTask: null,
    };
    delete legacyStatus.backfillSettings;
    delete legacyStatus.backfillLimit;
    useApiMock.mockReturnValue({
      data: legacyStatus,
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    apiMock.mockResolvedValue({ taskId: "task-new", status: "queued" });

    render(<SmartMixCoverage />);

    expect(screen.queryByText(/in flight$/)).toBeNull();
    expect(screen.queryByLabelText("Night start")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start backfill" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/smart-mix/backfill",
        "POST",
        {},
      );
    });
  });

  it("keeps invalid settings from reaching the API", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: { ...status, controlState: "paused", activeTask: null },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(<SmartMixCoverage />);

    await user.clear(screen.getByLabelText("Night in flight"));
    await user.type(screen.getByLabelText("Night in flight"), "40");
    await user.click(screen.getByRole("button", { name: "Resume backfill" }));
    fireEvent.change(screen.getByLabelText("Night in flight"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Night end"), {
      target: { value: "01:00" },
    });
    await user.click(screen.getByRole("button", { name: "Resume backfill" }));
    fireEvent.change(screen.getByLabelText("Night end"), {
      target: { value: "08:00" },
    });
    await user.clear(screen.getByLabelText("Timezone"));
    await user.type(screen.getByLabelText("Timezone"), "Mars/Base");
    await user.click(screen.getByRole("button", { name: "Resume backfill" }));

    expect(apiMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledTimes(3);
    expect(screen.getByLabelText("Timezone")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
