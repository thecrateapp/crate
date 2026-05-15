import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/contexts/AuthContext";
import { Login } from "./Login";

const refetchMock = vi.fn();

function mockAuth(value: Partial<ReturnType<typeof useAuth>>) {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    loading: false,
    logout: vi.fn(),
    isAdmin: false,
    refetch: refetchMock,
    ...value,
  } as ReturnType<typeof useAuth>);
}

describe("Login", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refetchMock.mockReset();
  });

  it("renders login form when unauthenticated", async () => {
    mockAuth({ user: null, loading: false });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
      headers: new Headers(),
    } as unknown as Response);

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /sign in/i }),
      ).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("shows loading spinner while auth state is loading", () => {
    mockAuth({ user: null, loading: true });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
