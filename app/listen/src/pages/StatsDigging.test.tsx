import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { openShareSheet } from "@/lib/social-share";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";
import { signalDashboard } from "@/test/stats-dashboard-fixture";

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
