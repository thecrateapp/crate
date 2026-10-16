import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import dashboardFixture from "../../../../tests/admin-e2e/fixtures/metrics-dashboard.json";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { useApiMock, refetchMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/task-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/task-catalog")>();
  return { ...actual, useTaskCatalog: () => null };
});

import { SystemHealth } from "./SystemHealth";

const dashboard = { ...dashboardFixture, timeseries: {} };
const resourcesDescription =
  "Storage pressure, database pool use and analysis backlog surfaced as operational cards.";

describe("SystemHealth Resources instrument", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    refetchMock.mockReset();
    useApiMock.mockReturnValue({
      data: dashboard,
      loading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  it("renders a named Resources figure with its heading, rule and description", () => {
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    const panel = screen.getByRole("figure");
    expect(panel).toHaveAccessibleName("Music volume uses 280 of 1000 GB.");
    expect(panel).toHaveClass("border-t", "border-border-quiet", "@container");
    const heading = within(panel).getByRole("heading", {
      level: 2,
      name: "Resources",
    });
    expect(within(panel).getByText(resourcesDescription)).toBeInTheDocument();
    const header = heading.closest("header") ?? heading.parentElement;
    expect(header).not.toBeNull();
    expect(header?.querySelector("svg")).toBeNull();
  });

  it("preserves the resource cards and their actual measurements", () => {
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    const panel = screen.getByRole("figure");
    for (const label of [
      "Music Volume",
      "Data Volume",
      "DB Pools",
      "Analysis",
    ]) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }
    for (const value of [
      "280 / 1000 GB",
      "720 GB free",
      "18 / 100 GB",
      "82 GB free",
      "2 / 8",
      "6 idle, 2 active",
      "851 / 863",
      "12 pending",
      "Bliss: 857 done, 6 pending",
    ]) {
      expect(within(panel).getByText(value)).toBeInTheDocument();
    }
  });

  it("retains the metrics window and refresh controls", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    expect(useApiMock).toHaveBeenCalledWith(
      "/api/admin/metrics/dashboard?period=minute&minutes=60",
    );
    await user.click(screen.getByRole("button", { name: "24h" }));
    expect(useApiMock).toHaveBeenLastCalledWith(
      "/api/admin/metrics/dashboard?period=hour&minutes=1440",
    );
    await user.click(screen.getByRole("button", { name: "Refresh metrics" }));
    expect(refetchMock).toHaveBeenCalledOnce();
    expect(
      within(screen.getByRole("figure")).getByText("280 / 1000 GB"),
    ).toBeInTheDocument();
  });

  it("does not invent a Resources figure while the system payload is absent", () => {
    useApiMock.mockReturnValue({
      data: { ...dashboard, system: null },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Resources" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "System Health" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh metrics" }),
    ).toBeInTheDocument();
  });
});
