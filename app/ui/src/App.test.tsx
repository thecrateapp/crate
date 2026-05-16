import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

describe("ProtectedRoute", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("redirects to login when user is not authenticated", () => {
    renderWithAdminProviders(
      <Routes>
        <Route
          path="/login"
          element={<div data-testid="login-page">Login</div>}
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div data-testid="dashboard">Dashboard</div>
            </ProtectedRoute>
          }
        />
      </Routes>,
      { route: "/dashboard", auth: { user: null } },
    );

    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("renders children when user is authenticated admin", async () => {
    renderWithAdminProviders(
      <Routes>
        <Route
          path="/login"
          element={<div data-testid="login-page">Login</div>}
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div data-testid="dashboard">Dashboard</div>
            </ProtectedRoute>
          }
        />
      </Routes>,
      {
        route: "/dashboard",
        auth: {
          user: {
            id: 1,
            email: "admin@example.test",
            name: "Admin",
            role: "admin",
          },
          isAdmin: true,
        },
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    });
  });
});
