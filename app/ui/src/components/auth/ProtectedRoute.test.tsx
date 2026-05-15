import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";

function mockAuth(value: Partial<ReturnType<typeof useAuth>>) {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    loading: false,
    logout: vi.fn(),
    isAdmin: false,
    refetch: vi.fn(),
    ...value,
  } as ReturnType<typeof useAuth>);
}

describe("ProtectedRoute", () => {
  it("shows spinner while loading", () => {
    mockAuth({ loading: true });
    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows admin required message when not admin", () => {
    mockAuth({
      user: { id: 1, email: "user@example.com", name: "User", role: "user" },
      loading: false,
      isAdmin: false,
    });
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>Protected</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/i)).toBeInTheDocument();
  });

  it("renders children when authenticated as admin", () => {
    mockAuth({
      user: { id: 1, email: "admin@example.com", name: "Admin", role: "admin" },
      loading: false,
      isAdmin: true,
    });
    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(screen.getByText("Protected")).toBeInTheDocument();
  });
});
