import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CapabilityRoute, ProtectedRoute } from "./ProtectedRoute";
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
          canAccessAdmin: false,
        },
      },
    );
    expect(
      screen.getByText(/Admin console access required/i),
    ).toBeInTheDocument();
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
          canAccessAdmin: true,
        },
      },
    );
    expect(screen.getByText("Protected")).toBeInTheDocument();
  });

  it("renders children for partial console roles", () => {
    renderWithAdminProviders(
      <ProtectedRoute>
        <div>Protected</div>
      </ProtectedRoute>,
      {
        auth: {
          user: {
            id: 2,
            email: "editor@example.com",
            name: "Editor",
            role: "editor",
            capabilities: ["library.view", "library.metadata.write"],
          },
          loading: false,
          isAdmin: false,
          canAccessAdmin: true,
          hasCapability: vi.fn((capability: string) =>
            ["library.view", "library.metadata.write"].includes(capability),
          ),
          hasAnyCapability: vi.fn((capabilities) =>
            capabilities.some((capability: string) =>
              ["library.view", "library.metadata.write"].includes(capability),
            ),
          ),
        },
      },
    );
    expect(screen.getByText("Protected")).toBeInTheDocument();
  });

  it("blocks a console route when the role lacks the route capability", () => {
    renderWithAdminProviders(
      <CapabilityRoute anyOf={["admin.access"]}>
        <div>Protected</div>
      </CapabilityRoute>,
      {
        auth: {
          user: {
            id: 2,
            email: "editor@example.com",
            name: "Editor",
            role: "editor",
            capabilities: ["library.view", "library.metadata.write"],
          },
          loading: false,
          canAccessAdmin: true,
          hasAnyCapability: vi.fn(() => false),
        },
      },
    );
    expect(screen.getByText(/Permission required/i)).toBeInTheDocument();
    expect(screen.queryByText("Protected")).not.toBeInTheDocument();
  });
});
