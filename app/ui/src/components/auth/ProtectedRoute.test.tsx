import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityRoute, ProtectedRoute } from "./ProtectedRoute";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

describe("ProtectedRoute", () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    ProtectedRoute,
    ({ children }: { children: React.ReactNode }) => (
      <CapabilityRoute anyOf={["admin.access"]}>{children}</CapabilityRoute>
    ),
  ])("reserves route loading and delays its indicator", (Guard) => {
    vi.useFakeTimers();
    renderWithAdminProviders(
      <Guard>
        <div>Protected</div>
      </Guard>,
      { auth: { loading: true } },
    );
    expect(document.querySelector(".animate-spin")).toBeNull();
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("progressbar")).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(
      screen.getByRole("progressbar", { name: "Loading" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Protected")).toBeNull();
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
    expect(
      screen.getByRole("group", { name: "Admin console access required" }),
    ).toHaveAttribute("data-variant", "page");
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
    expect(
      screen.getByRole("group", { name: "Permission required" }),
    ).toHaveAttribute("data-variant", "page");
    expect(screen.queryByText("Protected")).not.toBeInTheDocument();
  });
});
