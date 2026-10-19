import { act, fireEvent, screen, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import {
  activityFixture,
  aiSnapshot,
  migratedSnapshot,
  usageFixture,
} from "@/components/ai-models/test-fixtures";
import type { Activity, Snapshot, Usage } from "@/components/ai-models/types";

const { apiMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AiModels } from "./AiModels";

const NOW = new Date("2026-10-20T12:00:00.000Z");

function mockUseApi(
  snapshot: Snapshot | null,
  usage: Usage | null = null,
  activity: Activity | null = null,
  refetch = vi.fn(),
) {
  useApiMock.mockReset().mockImplementation((url: string | null) => ({
    data: url?.endsWith("/snapshot")
      ? snapshot
      : url?.endsWith("/usage")
        ? usage
        : url?.includes("/activity")
          ? activity
          : null,
    loading: false,
    error: null,
    refetch,
  }));
}

describe("AiModels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    apiMock.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("summarises the default model and today's usage in the header", () => {
    const snapshot = migratedSnapshot();
    mockUseApi(snapshot, usageFixture(NOW), activityFixture);
    renderWithAdminProviders(<AiModels />);

    expect(
      screen.getByText("gemini-3.8-flash · 3/4 features active"),
    ).toBeVisible();
    expect(screen.getByText("4")).toBeVisible();
    expect(screen.getByText("1,200")).toBeVisible();
    expect(screen.getByText("of 1,000,000 daily budget")).toBeVisible();
    expect(screen.getByText("1")).toBeVisible();

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/[a-f0-9]{64}/);
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
  });

  it("shows server settings before setup", () => {
    mockUseApi(aiSnapshot());
    renderWithAdminProviders(<AiModels />);

    expect(
      screen.getByText("gemini-3.8-flash · 4/4 features active"),
    ).toBeVisible();
    expect(screen.getByText("Using server settings")).toBeVisible();
  });

  it("does not fetch usage or activity without ai.usage.read", () => {
    mockUseApi(migratedSnapshot());
    renderWithAdminProviders(<AiModels />, {
      auth: { hasCapability: (cap) => cap !== "ai.usage.read" },
    });

    expect(
      useApiMock.mock.calls.some(([url]) => {
        if (typeof url !== "string") return false;
        return url.includes("/usage") || url.includes("/activity");
      }),
    ).toBe(false);
    expect(screen.queryByText("Calls today")).not.toBeInTheDocument();
  });

  it("shows a loading state while the snapshot is in flight", () => {
    useApiMock.mockReset().mockImplementation((url: string | null) => ({
      data: null,
      loading: url?.endsWith("/snapshot") ?? false,
      error: null,
      refetch: vi.fn(),
    }));
    renderWithAdminProviders(<AiModels />);

    expect(screen.getByText("Loading AI settings…")).toBeVisible();
  });

  it("shows a readable error state with a retry control", () => {
    const refetch = vi.fn();
    useApiMock.mockReset().mockImplementation((url: string | null) => ({
      data: null,
      loading: false,
      error: url?.endsWith("/snapshot")
        ? '{"detail":"Internal Server Error","code":"AI_STORE_DOWN"}'
        : null,
      refetch,
    }));
    renderWithAdminProviders(<AiModels />);

    expect(
      screen.getByText("Couldn't load AI settings. Try again."),
    ).toBeVisible();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("detail");
    expect(text).not.toContain("AI_STORE_DOWN");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the default model and the features with their last run", () => {
    mockUseApi(migratedSnapshot(), usageFixture(NOW), activityFixture);
    renderWithAdminProviders(<AiModels />);

    expect(
      screen.getByRole("heading", { name: "Default model" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Features" })).toBeVisible();
    expect(screen.getAllByText(/Last run/)).toHaveLength(1);
    expect(screen.getAllByText("No recent runs")).toHaveLength(3);
  });

  it("keeps the previous routing when applying a default conflicts", async () => {
    const refetch = vi.fn();
    mockUseApi(migratedSnapshot(), null, null, refetch);
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error('{"detail":"conflict"}'), {
        status: 409,
        code: "AI_CONFIGURATION_CONFLICT",
      }),
    );
    renderWithAdminProviders(<AiModels />);

    fireEvent.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );
    await act(async () => {});

    expect(toast.error).toHaveBeenCalledWith(
      "AI settings changed while you were editing. Review and try again.",
    );
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const eq = screen.getByRole("listitem", { name: "Propose genre EQ" });
    expect(within(eq).getByText("Override")).toBeVisible();
    expect(screen.getByText(/Current default: gemini-3.8-flash/)).toBeVisible();
  });

  it("flags a truncated snapshot", () => {
    mockUseApi({ ...aiSnapshot(), truncated: true });
    renderWithAdminProviders(<AiModels />);

    expect(
      screen.getByText(
        "Some saved profiles are not shown. Only the most recent ones can be used here.",
      ),
    ).toBeVisible();
  });

  it("flags an unavailable default model", () => {
    const snapshot = migratedSnapshot();
    snapshot.default_model = {
      ...snapshot.default_model!,
      available: false,
    };
    mockUseApi(snapshot);
    renderWithAdminProviders(<AiModels />);

    expect(screen.getByText("Default model unavailable")).toBeVisible();
  });
});
