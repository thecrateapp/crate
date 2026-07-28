import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Login } from "@/pages/Login";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: vi.fn(() => new Promise(() => {})),
  setAuthTokens: vi.fn(),
}));

vi.mock("@/components/auth/OAuthButtons", () => ({
  OAuthButtons: () => null,
}));

describe("Login", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the auth form in the active locale", async () => {
    renderWithListenProviders(<Login />, {
      auth: { user: null, loading: false },
      locale: "es",
      route: "/login",
    });

    expect(
      await screen.findByText("Tu música, a tu manera"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Iniciar sesión" }),
    ).toBeInTheDocument();
    expect(screen.getByText("¿No tienes cuenta?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crea una" })).toBeInTheDocument();
  });
});
