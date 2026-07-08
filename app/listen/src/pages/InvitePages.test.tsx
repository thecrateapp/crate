import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { JamInvite } from "@/pages/JamInvite";
import { PlaylistInvite } from "@/pages/PlaylistInvite";

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  getApiBase: vi.fn(() => ""),
  getAuthToken: vi.fn(() => null),
}));

describe("invite pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("localizes the jam invite loading state", () => {
    renderWithListenProviders(<JamInvite />, {
      locale: "es",
      route: "/jam/invite/abc123",
      path: "/jam/invite/:token",
    });

    expect(screen.getByText("Entrando en la sala...")).toBeVisible();
    expect(
      screen.getByText(
        "Estamos validando la invitación y añadiéndote a la sesión.",
      ),
    ).toBeVisible();
  });

  it("localizes the playlist invite loading state", () => {
    renderWithListenProviders(<PlaylistInvite />, {
      locale: "es",
      route: "/playlist/invite/abc123",
      path: "/playlist/invite/:token",
    });

    expect(screen.getByText("Entrando en la playlist...")).toBeVisible();
    expect(
      screen.getByText(
        "Estamos validando la invitación y añadiéndote como colaborador.",
      ),
    ).toBeVisible();
  });
});
