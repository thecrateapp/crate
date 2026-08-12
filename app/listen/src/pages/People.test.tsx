import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { People } from "@/pages/People";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(async () => []),
  getApiBase: vi.fn(() => ""),
  getAuthToken: vi.fn(() => null),
}));

describe("People", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApi).mockReturnValue({
      data: {
        followers_count: 4,
        following_count: 7,
        friends_count: 2,
        profile: {
          id: 1,
          username: "diego",
          display_name: "Diego",
          avatar: null,
          bio: null,
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("localizes the social landing page", () => {
    renderWithListenProviders(<People />, {
      locale: "es",
      auth: {
        user: {
          id: 1,
          email: "diego@example.test",
          name: "Diego",
          role: "user",
          username: "diego",
        },
      },
    });

    expect(screen.getByRole("heading", { name: "Gente" })).toBeVisible();
    expect(screen.getByText("Tu perfil")).toBeVisible();
    expect(screen.getByText("Seguidores")).toBeVisible();
    expect(screen.getByText("Amigos")).toBeVisible();
    expect(
      screen.getByPlaceholderText("Busca por usuario o nombre visible"),
    ).toBeVisible();
    expect(screen.queryByText("Sesiones Jam")).toBeNull();
  });
});
