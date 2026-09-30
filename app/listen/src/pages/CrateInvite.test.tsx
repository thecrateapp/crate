import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  getApiBase: vi.fn(() => ""),
  getAuthToken: vi.fn(() => null),
}));

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mocks.navigate };
});

import { CrateInvite } from "@/pages/CrateInvite";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("CrateInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.mockResolvedValue({ crate_id: "crate-123" });
  });

  it("accepts the invite and opens the Crate", async () => {
    renderWithListenProviders(<CrateInvite />, {
      locale: "es",
      path: "/crate/invite/:token",
      route: "/crate/invite/secret-token",
    });

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/crates/invites/secret-token/accept",
        "POST",
        {},
      ),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/crate/crate-123", {
        replace: true,
      }),
    );
    expect(screen.getByText("Entrando en el Crate...")).toBeVisible();
  });

  it("sends an invalid invite back to Collection", async () => {
    mocks.api.mockRejectedValue(new Error("expired"));
    renderWithListenProviders(<CrateInvite />, {
      path: "/crate/invite/:token",
      route: "/crate/invite/expired-token",
    });

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/collection?tab=crates", {
        replace: true,
      }),
    );
  });
});
