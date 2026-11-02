import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { useApiMock, charts } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  charts: [] as Record<string, unknown>[],
}));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@nivo/line", () => ({
  ResponsiveLine: (props: Record<string, unknown>) => {
    charts.push(props);
    return null;
  },
}));

import { Product } from "./Product";

const data = {
  window_days: 7,
  current_start: "2026-10-27",
  previous_start: "2026-10-20",
  end: "2026-11-02",
  computed_at: "2026-11-02T14:00:00Z",
  minimum_sample: 3,
  series: [
    {
      kpi: "listening.plays",
      dims: {},
      points: [
        { day: "2026-10-21", value: 40, sample: 4, suppressed: false },
        { day: "2026-10-30", value: 25, sample: 4, suppressed: false },
        { day: "2026-11-01", value: 35, sample: 5, suppressed: false },
      ],
    },
    {
      kpi: "listening.plays_by_platform",
      dims: { platform: "android" },
      points: [{ day: "2026-11-01", value: 30, sample: 4, suppressed: false }],
    },
    {
      kpi: "listening.plays_by_platform",
      dims: { platform: "ios" },
      points: [{ day: "2026-11-01", value: null, sample: 1, suppressed: true }],
    },
  ],
};

beforeEach(() => {
  useApiMock.mockReset();
  charts.length = 0;
});

describe("Product", () => {
  it("shows KPI tiles with their change and hides small segments", () => {
    useApiMock.mockReturnValue({
      data,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithAdminProviders(<Product />);

    expect(
      screen.getByRole("heading", { name: "Product", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Computed 2026-11-02 14:00 UTC"),
    ).toBeInTheDocument();
    const listening = screen.getByRole("region", { name: "Listening" });
    expect(within(listening).getByText("60")).toBeInTheDocument();
    expect(
      within(listening).getByText("+50% vs previous 7 days"),
    ).toBeInTheDocument();
    expect(
      within(listening).getByText("Hidden, fewer than 3 listeners"),
    ).toBeInTheDocument();
    expect(charts).toHaveLength(1);
    expect(
      screen.getAllByText("No data in this window").length,
    ).toBeGreaterThan(5);
  });

  it("requests the selected window", async () => {
    useApiMock.mockReturnValue({
      data,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithAdminProviders(<Product />);

    await userEvent.click(screen.getByRole("radio", { name: "90d" }));

    expect(useApiMock).toHaveBeenLastCalledWith("/api/admin/kpis?days=90");
  });

  it("explains an empty history and a failed load", () => {
    useApiMock.mockReturnValue({
      data: { ...data, computed_at: null, series: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = renderWithAdminProviders(<Product />);
    expect(screen.getByText("No product KPIs yet")).toBeInTheDocument();
    expect(screen.getByText("Not computed yet")).toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    useApiMock.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch,
    });
    renderWithAdminProviders(<Product />);
    expect(
      screen.getByText("Could not load product KPIs."),
    ).toBeInTheDocument();
  });
});
