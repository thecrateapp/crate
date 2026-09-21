import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const { apiMock, toastErrorMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 999 },
    hasCapability: () => true,
  }),
}));

vi.mock("@/components/users/UserMap", () => ({
  UserMap: () => <div data-testid="user-map" />,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
  },
}));

import { Users } from "./Users";

const recentActivity = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const staleActivity = new Date(
  Date.now() - 31 * 24 * 60 * 60 * 1000,
).toISOString();

const users = Array.from({ length: 21 }, (_, index) => {
  const id = index + 1;
  const inactive = id === 21;
  return {
    id,
    email: `user-${id}@example.com`,
    name: `User ${id}`,
    avatar: null,
    role: "user",
    roles: ["user"],
    status: "active",
    connected_accounts: [],
    online_now: false,
    listening_now: false,
    active_devices: 0,
    active_sessions: 0,
    current_track: null,
    last_played_at: null,
    last_seen_at: null,
    last_login: inactive ? staleActivity : recentActivity,
    created_at: "2025-01-01T00:00:00Z",
    last_activity_at: inactive ? staleActivity : recentActivity,
    activity_status: inactive ? "inactive" : "active",
  };
});

describe("Users", () => {
  beforeEach(() => {
    apiMock.mockReset();
    toastErrorMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/auth/users") return Promise.resolve(users);
      return Promise.resolve({});
    });
  });

  it("labels and filters inactive users without changing account status", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Showing 1-20 of 21 users"),
    ).toBeInTheDocument();
    expect(screen.getByText("Inactive 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inactive 1" }));

    expect(screen.getByText("Showing 1-1 of 1 users")).toBeInTheDocument();
    expect(screen.getByText("user-21@example.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("paginates the rendered users", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Showing 1-20 of 21 users"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Showing 21-21 of 21 users")).toBeInTheDocument();
    expect(screen.getByText("user-21@example.com")).toBeInTheDocument();
  });

  it("does not report an aborted user detail request as a failure", async () => {
    const user = userEvent.setup();
    let detailSignal: AbortSignal | undefined;
    apiMock.mockImplementation(
      (
        path: string,
        _method?: string,
        _body?: unknown,
        options?: RequestInit,
      ) => {
        if (path === "/api/auth/users") return Promise.resolve(users);
        if (path === "/api/auth/users/1") {
          detailSignal = options?.signal ?? undefined;
          return new Promise((_resolve, reject) => {
            detailSignal?.addEventListener("abort", () => {
              reject(new DOMException("The request was aborted", "AbortError"));
            });
          });
        }
        return Promise.resolve({});
      },
    );

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>,
    );

    await screen.findByText("Showing 1-20 of 21 users");
    const inspectButton = screen.getAllByRole("button", {
      name: "Inspect",
    })[0];
    expect(inspectButton).toBeDefined();
    await user.click(inspectButton!);
    await waitFor(() => expect(detailSignal).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(detailSignal?.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
