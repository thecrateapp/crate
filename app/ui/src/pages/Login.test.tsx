import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Login } from "./Login";

vi.mock("react-router", () => ({
  Navigate: ({ to }: { to: string }) => (
    <div data-testid="navigate">Navigate to {to}</div>
  ),
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return { ...mod, api: vi.fn(() => Promise.resolve({})) };
});

import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";

const mockApi = vi.mocked(api);
const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user: null,
    loading: false,
    refetch: vi.fn(),
  } as any);
});

describe("Login", () => {
  it("shows loading spinner when auth is loading", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      refetch: vi.fn(),
    } as any);
    const { container } = render(<Login />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("redirects when user is already logged in", () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1 },
      loading: false,
      refetch: vi.fn(),
    } as any);
    render(<Login />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("Navigate to /");
  });

  it("renders login form", () => {
    render(<Login />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it("submits login and calls api", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ user: null, loading: false, refetch } as any);

    render(<Login />);
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

    render(<Login />);
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

    render(<Login />);
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

    render(<Login />);
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

    render(<Login />);
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
