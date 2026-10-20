import { useReducer } from "react";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { openShareSheet } from "@/lib/social-share";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";
import { baseDashboard, signalDashboard } from "@/test/stats-dashboard-fixture";

import { StatsDigging } from "./StatsDigging";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/social-share", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/social-share")>()),
  openShareSheet: vi.fn(),
}));

describe("StatsDigging", () => {
  beforeEach(() => {
    vi.mocked(openShareSheet).mockReset();
    vi.mocked(useApi).mockImplementation((url: string | null) => ({
      data: url === "/api/me/stats/today" ? null : signalDashboard(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
  });

  it.each(["loading", "error", "empty"] as const)(
    "shows a useful %s route state with a way back",
    (state) => {
      vi.mocked(useApi).mockReturnValue({
        data: state === "empty" ? baseDashboard() : null,
        loading: state === "loading",
        error: state === "error" ? "Internal read error" : null,
        refetch: vi.fn(),
      });
      renderWithListenProviders(<StatsDigging />, {
        route: "/stats/digging?window=30d",
        path: "/stats/digging",
        locale: "en",
      });
      expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
      expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      if (state === "loading") expect(screen.getByRole("status")).toBeVisible();
      if (state === "error")
        expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
      if (state === "empty")
        expect(screen.getByTestId("empty-state")).toBeVisible();
    },
  );

  it("shows loading for a cold pending snapshot before populated or confirmed-empty results", () => {
    vi.mocked(useApi).mockReturnValue({
      data: { ...baseDashboard(), snapshot: { version: 0, pending: true } },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    function Fixture() {
      const [, refresh] = useReducer((value) => value + 1, 0);
      return (
        <>
          <button type="button" onClick={refresh}>
            Refresh fixture
          </button>
          <StatsDigging />
        </>
      );
    }
    renderWithListenProviders(<Fixture />, {
      route: "/stats/digging",
      path: "/stats/digging",
      locale: "en",
    });
    expect(screen.getByTestId("loading-state")).toBeVisible();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
    vi.mocked(useApi).mockReturnValue({
      data: signalDashboard(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh fixture" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    vi.mocked(useApi).mockReturnValue({
      data: { ...baseDashboard(), snapshot: { version: 1, pending: false } },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh fixture" }));
    expect(screen.getByTestId("empty-state")).toBeVisible();
  });

  it("walks the chapters and shares the summary card", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<StatsDigging />, {
      route: "/stats/digging?window=30d",
      path: "/stats/digging",
      locale: "es",
      auth: {
        user: createMockAuthUser({
          id: 1,
          instagram_handle: "diego.trecedoce",
        }),
      },
    });

    const dialog = screen.getByRole("dialog", {
      name: "Tu Crate Digging",
    });
    expect(screen.getByText("minutos escuchados")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(
      screen.getByRole("heading", { name: "Converge" }),
    ).toBeInTheDocument();
    for (let step = 0; step < 6; step += 1) {
      fireEvent.keyDown(dialog, { key: "ArrowRight" });
    }
    expect(screen.getByText("Converge, sin dudarlo.")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Compartir en Instagram" }),
    );

    expect(openShareSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "digging",
        title: "Últimos 30 días en Crate",
        digging: expect.objectContaining({
          headline: "Converge, sin dudarlo.",
          credit: "Un año seleccionado por diego.trecedoce",
          topArtistsLabel: "Artistas top",
        }),
      }),
    );
  });
});
