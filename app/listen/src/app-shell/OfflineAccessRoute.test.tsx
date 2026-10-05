import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/PlayerContext", () => ({
  PlayerProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/contexts/OfflineContext", () => ({
  OfflineProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/pages/OfflineLibrary", () => ({
  OfflineLibrary: () => <div>local-library</div>,
}));

import { OfflineAccessRoute } from "@/app-shell/OfflineAccessRoute";
import { AuthContext, type AuthContextValue } from "@/contexts/auth-context";

const identity = {
  schemaVersion: 1 as const,
  serverId: "server-a",
  serverUrl: "https://a.example.test",
  userId: 42,
  profileKey: "profile-a-42",
  generation: 1,
};

function renderOfflineRoute(value: AuthContextValue) {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={["/offline"]}>
        <Routes>
          <Route path="/offline" element={<OfflineAccessRoute />} />
          <Route path="/login" element={<div>login-page</div>} />
          <Route path="/" element={<div>online-home</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function authValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: null,
    loading: false,
    accessMode: "unauthenticated",
    offlineIdentity: null,
    refetch: vi.fn(async () => null),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("OfflineAccessRoute", () => {
  it("renders the local library only with an offline identity", () => {
    renderOfflineRoute(
      authValue({ accessMode: "offline", offlineIdentity: identity }),
    );

    expect(screen.getByText("local-library")).toBeInTheDocument();
  });

  it("does not grant the local library to an unauthenticated session", () => {
    renderOfflineRoute(authValue());

    expect(screen.getByText("login-page")).toBeInTheDocument();
    expect(screen.queryByText("local-library")).not.toBeInTheDocument();
  });

  it("returns an authenticated user to the online app", () => {
    renderOfflineRoute(
      authValue({
        user: {
          id: 42,
          email: "listener@example.test",
          name: "Listener",
          role: "user",
        },
        accessMode: "authenticated",
      }),
    );

    expect(screen.getByText("online-home")).toBeInTheDocument();
  });
});
