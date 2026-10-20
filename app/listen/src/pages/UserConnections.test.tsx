import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { UserConnections } from "@/pages/UserConnections";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

describe("UserConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("localizes followers lists", () => {
    vi.mocked(useApi).mockReturnValue({
      data: [
        {
          id: 2,
          username: "ana",
          display_name: "Ana",
          avatar: null,
          followed_at: "2026-01-01T00:00:00Z",
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<UserConnections />, {
      locale: "es",
      route: "/users/diego/followers",
      path: "/users/:username/followers",
    });

    expect(screen.getByText("Volver al perfil")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Seguidores" })).toBeVisible();
    expect(screen.getByText("Conexiones públicas de @diego.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Ana/ })).toHaveAttribute(
      "href",
      "/users/ana",
    );
    expect(
      screen.getByRole("button", { name: "Más acciones" }),
    ).toBeInTheDocument();
  });

  it("localizes empty following lists", () => {
    vi.mocked(useApi).mockReturnValue({
      data: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<UserConnections />, {
      locale: "es",
      route: "/users/diego/following",
      path: "/users/:username/following",
    });

    expect(screen.getByRole("heading", { name: "Siguiendo" })).toBeVisible();
    expect(screen.getByText("Aún no sigue a nadie.")).toBeVisible();
  });
});

it("reserves avatar rows instead of a table while loading", () => {
  vi.mocked(useApi).mockReturnValue({
    data: null,
    loading: true,
    error: null,
    refetch: vi.fn(),
  });
  const { container } = renderWithListenProviders(<UserConnections />, {
    route: "/users/diego/followers",
    path: "/users/:username/followers",
  });
  expect(screen.getByRole("status")).toHaveAccessibleName();
  expect(
    container.querySelectorAll('[data-slot="skeleton-user-row"]'),
  ).toHaveLength(5);
  expect(container.querySelector('[data-slot="skeleton-table"]')).toBeNull();
});

it("keeps failed reads distinct from an empty connections list", () => {
  const retry = vi.fn();
  vi.mocked(useApi).mockReturnValue({
    data: null,
    loading: false,
    error: "offline",
    refetch: retry,
  });
  renderWithListenProviders(<UserConnections />, {
    route: "/users/diego/followers",
    path: "/users/:username/followers",
  });
  expect(screen.getByRole("alert")).toBeVisible();
  screen.getByRole("button", { name: "Retry" }).click();
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByText("No followers yet.")).toBeNull();
});
