import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { read, refreshStatus, refreshRuns, refreshDuplicates } = vi.hoisted(
  () => ({
    read: vi.fn(),
    refreshStatus: vi.fn(),
    refreshRuns: vi.fn(),
    refreshDuplicates: vi.fn(),
  }),
);
vi.mock("@/hooks/use-api", () => ({ useApi: read }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasAnyCapability: () => true }),
}));
import { GlobalCatalog } from "./GlobalCatalog";

describe("Global catalog read recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    read.mockImplementation((url: string) => ({
      data: null,
      loading: true,
      error: null,
      refetch: url.includes("/runs")
        ? refreshRuns
        : url.includes("/duplicates")
          ? refreshDuplicates
          : refreshStatus,
    }));
  });

  it("keeps unknown counts and last run out of confirmed empty presentation", () => {
    render(<GlobalCatalog />);
    expect(
      screen.getByRole("status", { name: "Loading catalog status" }),
    ).toBeVisible();
    expect(
      screen.queryByText("No reconciliation runs yet."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();
  });

  it("offers scoped recovery for failed runs and duplicates", async () => {
    read.mockImplementation((url: string) => ({
      data: null,
      loading: false,
      error: "network failure",
      refetch: url.includes("/runs")
        ? refreshRuns
        : url.includes("/duplicates")
          ? refreshDuplicates
          : refreshStatus,
    }));
    render(<GlobalCatalog />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Runs" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    expect(
      await screen.findByText("Catalog runs could not be loaded."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refreshRuns).toHaveBeenCalledOnce();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Duplicates" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("tab", { name: "Duplicates" }));
    expect(
      await screen.findByText("Duplicate candidates could not be loaded."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refreshDuplicates).toHaveBeenCalledOnce();
  });

  it("refreshes all three surfaces from the header", () => {
    read.mockImplementation((url: string) => ({
      data: null,
      loading: false,
      error: "network failure",
      refetch: url.includes("/runs")
        ? refreshRuns
        : url.includes("/duplicates")
          ? refreshDuplicates
          : refreshStatus,
    }));
    render(<GlobalCatalog />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshStatus).toHaveBeenCalledOnce();
    expect(refreshRuns).toHaveBeenCalledOnce();
    expect(refreshDuplicates).toHaveBeenCalledOnce();
  });
});
