import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Register } from "@/pages/Register";
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

describe("Register", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the registration form in the active locale", () => {
    renderWithListenProviders(<Register />, {
      auth: { user: null, loading: false },
      locale: "es",
      route: "/register",
    });

    expect(
      screen.getByRole("heading", { name: "Crear cuenta" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tu música, a tu manera")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tu nombre")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Mínimo 8 caracteres"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Crear cuenta" }),
    ).toBeInTheDocument();
    expect(screen.getByText("¿Ya tienes cuenta?")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Iniciar sesión" }),
    ).toBeInTheDocument();
  });
});
