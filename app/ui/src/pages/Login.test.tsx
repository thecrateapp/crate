import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { Login } from "./Login";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return { ...mod, api: vi.fn(() => Promise.resolve({})) };
});

import { api, ApiError } from "@/lib/api";

const mockApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Login", () => {
  it("shows loading spinner when auth is loading", () => {
    const { container } = renderWithAdminProviders(<Login />, {
      auth: { user: null, loading: true },
    });
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("redirects when user is already logged in", () => {
    renderWithAdminProviders(
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<div data-testid="home">Home</div>} />
      </Routes>,
      {
        route: "/login",
        auth: { user: { id: 1, email: "", name: "", role: "user" } },
      },
    );
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  it("renders login form", () => {
    renderWithAdminProviders(<Login />, {
      auth: { user: null },
    });
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it("submits login and calls api", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    renderWithAdminProviders(<Login />, {
      auth: { user: null, refetch },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/auth/login", "POST", {
        email: "a@b.com",
        password: "secret",
      });
    });
  });

  it("disables button during submit", async () => {
    mockApi.mockImplementation((path: string) => {
      if (path === "/api/auth/login") return new Promise(() => {});
      return Promise.resolve({});
    });

    renderWithAdminProviders(<Login />, {
      auth: { user: null },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
  });

  it("shows invite-only banner when config says so", async () => {
    mockApi.mockImplementation((path: string) => {
      if (path === "/api/auth/config") {
        return Promise.resolve({ invite_only: true });
      }
      return Promise.resolve({});
    });

    renderWithAdminProviders(<Login />, {
      auth: { user: null },
    });
    await waitFor(() => {
      expect(screen.getByText(/invite-only/i)).toBeInTheDocument();
    });
  });

  it("shows error on ApiError", async () => {
    mockApi.mockImplementation((path: string) => {
      if (path === "/api/auth/login") {
        return Promise.reject(
          new ApiError(401, JSON.stringify({ detail: "Bad creds" })),
        );
      }
      return Promise.resolve({});
    });

    renderWithAdminProviders(<Login />, {
      auth: { user: null },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText("Bad creds")).toBeInTheDocument();
    });
  });

  it("shows connection error on non-ApiError", async () => {
    mockApi.mockImplementation((path: string) => {
      if (path === "/api/auth/login") {
        return Promise.reject(new Error("network"));
      }
      return Promise.resolve({});
    });

    renderWithAdminProviders(<Login />, {
      auth: { user: null },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText("Connection error")).toBeInTheDocument();
    });
  });
});
