import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

describe("ProtectedRoute", () => {
  it("shows spinner while loading", () => {
    renderWithAdminProviders(
      <ProtectedRoute>
        <div>Protected</div>
      </ProtectedRoute>,
      { auth: { loading: true } },
    );
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows admin required message when not admin", () => {
    renderWithAdminProviders(
      <ProtectedRoute>
        <div>Protected</div>
      </ProtectedRoute>,
      {
        auth: {
          user: {
            id: 1,
            email: "user@example.com",
            name: "User",
            role: "user",
          },
          isAdmin: false,
        },
      },
    );
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/i)).toBeInTheDocument();
  });

  it("renders children when authenticated as admin", () => {
    renderWithAdminProviders(
      <ProtectedRoute>
        <div>Protected</div>
      </ProtectedRoute>,
      {
        auth: {
          user: {
            id: 1,
            email: "admin@example.com",
            name: "Admin",
            role: "admin",
          },
          isAdmin: true,
        },
      },
    );
    expect(screen.getByText("Protected")).toBeInTheDocument();
  });
});
