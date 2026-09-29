import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  clearQueueMock,
  consumePendingOAuthNextMock,
  getApiBaseMock,
  getAuthTokenExpiresAtMock,
  getAuthTokenMock,
  navigateMock,
  primeOfflineRuntimeProfileMock,
  getCurrentServerIdMock,
  getCurrentServerMock,
  revokeServerSessionMock,
  refreshAuthTokenMock,
  setActiveOfflineProfileKeyMock,
  setAuthTokenMock,
  syncOfflineProfileToServiceWorkerMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  clearQueueMock: vi.fn(),
  consumePendingOAuthNextMock: vi.fn<() => string | null>(() => null),
  getApiBaseMock: vi.fn(() => ""),
  getAuthTokenExpiresAtMock: vi.fn<() => string | null>(() => null),
  getAuthTokenMock: vi.fn<() => string | null>(() => null),
  navigateMock: vi.fn(),
  primeOfflineRuntimeProfileMock: vi.fn(),
  getCurrentServerIdMock: vi.fn<() => string | null>(() => null),
  getCurrentServerMock: vi.fn<() => unknown>(() => null),
  revokeServerSessionMock: vi.fn(() => Promise.resolve()),
  refreshAuthTokenMock: vi.fn(() => Promise.resolve(false)),
  setActiveOfflineProfileKeyMock: vi.fn(),
  setAuthTokenMock: vi.fn(),
  syncOfflineProfileToServiceWorkerMock: vi.fn(),
}));

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/api", () => ({
  AUTH_TOKEN_EVENT: "crate:auth-token-updated",
  api: apiMock,
  getApiBase: getApiBaseMock,
  getAuthToken: getAuthTokenMock,
  getAuthTokenExpiresAt: getAuthTokenExpiresAtMock,
  refreshAuthToken: refreshAuthTokenMock,
  revokeServerSession: revokeServerSessionMock,
  setAuthToken: setAuthTokenMock,
}));

vi.mock("@/lib/server-store", () => ({
  SERVER_STORE_EVENT: "crate-server-store-change",
  getCurrentServer: getCurrentServerMock,
  getCurrentServerId: getCurrentServerIdMock,
}));

vi.mock("@/lib/capacitor", () => ({
  consumePendingOAuthNext: consumePendingOAuthNextMock,
}));

vi.mock("@/lib/offline", () => ({
  primeOfflineRuntimeProfile: primeOfflineRuntimeProfileMock,
  setActiveOfflineProfileKey: setActiveOfflineProfileKeyMock,
  syncOfflineProfileToServiceWorker: syncOfflineProfileToServiceWorkerMock,
}));

vi.mock("@/lib/play-event-queue", () => ({
  clearQueue: clearQueueMock,
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import { ApiError } from "../../../shared/web/api";

function AuthProbe() {
  const { user, loading, logout, refetch, sessionUnavailable } = useAuth();
  return (
    <div>
      <div>{loading ? "loading" : user ? `user:${user.id}` : "anon"}</div>
      {sessionUnavailable ? <div>session-unavailable</div> : null}
      <button onClick={() => void refetch()}>refetch</button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    apiMock.mockReset();
    clearQueueMock.mockReset();
    consumePendingOAuthNextMock.mockReset();
    consumePendingOAuthNextMock.mockReturnValue(null);
    getApiBaseMock.mockReset();
    getApiBaseMock.mockReturnValue("");
    getCurrentServerIdMock.mockReset();
    getCurrentServerIdMock.mockReturnValue(null);
    getCurrentServerMock.mockReset();
    getCurrentServerMock.mockReturnValue(null);
    getAuthTokenExpiresAtMock.mockReset();
    getAuthTokenExpiresAtMock.mockReturnValue(null);
    getAuthTokenMock.mockReset();
    getAuthTokenMock.mockReturnValue(null);
    navigateMock.mockReset();
    primeOfflineRuntimeProfileMock.mockReset();
    revokeServerSessionMock.mockReset();
    revokeServerSessionMock.mockResolvedValue(undefined);
    refreshAuthTokenMock.mockReset();
    refreshAuthTokenMock.mockResolvedValue(false);
    setActiveOfflineProfileKeyMock.mockReset();
    setAuthTokenMock.mockReset();
    syncOfflineProfileToServiceWorkerMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("hydrates the session on boot and primes the offline profile", async () => {
    apiMock.mockResolvedValueOnce({
      id: 7,
      email: "listener@example.test",
      name: "Listener",
      role: "user",
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("user:7")).toBeTruthy();
    expect(localStorage.getItem("listen-auth-user-id")).toBe("7");
    expect(primeOfflineRuntimeProfileMock).toHaveBeenCalledTimes(1);
  });

  it("clears derived runtime state when boot hydration ends unauthenticated", async () => {
    apiMock.mockResolvedValueOnce(null);

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("anon")).toBeTruthy();
    expect(setActiveOfflineProfileKeyMock).toHaveBeenCalledWith(null);
    expect(syncOfflineProfileToServiceWorkerMock).toHaveBeenCalledWith(null);
  });

  it("keeps the current user when session hydration hits a transient server error", async () => {
    apiMock
      .mockResolvedValueOnce({
        id: 7,
        email: "listener@example.test",
        name: "Listener",
        role: "user",
      })
      .mockRejectedValueOnce(
        Object.assign(new Error("Service unavailable"), { status: 503 }),
      );

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("user:7")).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "refetch" }));

    await waitFor(() => {
      expect(screen.getByText("user:7")).toBeTruthy();
    });
    expect(syncOfflineProfileToServiceWorkerMock).not.toHaveBeenCalledWith(
      null,
    );
  });

  it("does not turn a stored session into anonymous state during a transient boot error", async () => {
    localStorage.setItem("listen-auth-user-id", "7");
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error("Service unavailable"), { status: 503 }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("session-unavailable")).toBeTruthy();
    expect(setActiveOfflineProfileKeyMock).not.toHaveBeenCalledWith(null);
    expect(syncOfflineProfileToServiceWorkerMock).not.toHaveBeenCalledWith(
      null,
    );
  });

  it.each([401, 403])(
    "clears an authenticated session when the API rejects it with ApiError %s",
    async (status) => {
      apiMock
        .mockResolvedValueOnce({
          id: 7,
          email: "listener@example.test",
          name: "Listener",
          role: "user",
        })
        .mockRejectedValueOnce(new ApiError(status, "Session expired"));

      render(
        <MemoryRouter>
          <AuthProvider>
            <AuthProbe />
          </AuthProvider>
        </MemoryRouter>,
      );

      expect(await screen.findByText("user:7")).toBeTruthy();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "refetch" }));

      expect(await screen.findByText("anon")).toBeTruthy();
      expect(screen.queryByText("session-unavailable")).not.toBeInTheDocument();
      expect(syncOfflineProfileToServiceWorkerMock).toHaveBeenCalledWith(null);
    },
  );

  it("retries transient boot failures with a bounded backoff and then redirects to login state", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    apiMock.mockRejectedValue(new Error("Service unavailable"));

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("session-unavailable")).toBeInTheDocument();

    for (const delay of [1500, 3000, 6000, 12000, 24000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay + 1);
      });
    }

    expect(apiMock).toHaveBeenCalledTimes(6);
    expect(screen.getByText("anon")).toBeInTheDocument();
    expect(screen.queryByText("session-unavailable")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("clears a pending auth retry when the provider unmounts", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    apiMock.mockRejectedValue(new Error("Service unavailable"));

    const { unmount } = render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("drops previous playback state when the hydrated user changes", async () => {
    const authReset = vi.fn();
    window.addEventListener(
      AUTH_RUNTIME_RESET_EVENT,
      authReset as EventListener,
    );
    localStorage.setItem("listen-auth-user-id", "41");
    localStorage.setItem("listen-player-state", '{"queue":[]}');
    localStorage.setItem("listen-recently-played", "[]");
    localStorage.setItem("listen-player-state:v1", '{"queue":[{"id":"a"}]}');
    localStorage.setItem("listen-recently-played:v1", '[{"id":"a"}]');
    apiMock.mockResolvedValueOnce({
      id: 42,
      email: "new@example.test",
      name: "New",
      role: "user",
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("user:42")).toBeTruthy();
    expect(localStorage.getItem("listen-player-state")).toBeNull();
    expect(localStorage.getItem("listen-recently-played")).toBeNull();
    expect(localStorage.getItem("listen-player-state:v1")).toBeNull();
    expect(localStorage.getItem("listen-recently-played:v1")).toBeNull();
    expect(clearQueueMock).toHaveBeenCalledTimes(1);
    expect(authReset).toHaveBeenCalledTimes(1);
    expect((authReset.mock.calls[0]?.[0] as CustomEvent).detail.reason).toBe(
      "user-change",
    );
    window.removeEventListener(
      AUTH_RUNTIME_RESET_EVENT,
      authReset as EventListener,
    );
  });

  it("resets the old server and ignores its late session response after a switch", async () => {
    let resolveServerA!: (value: unknown) => void;
    const serverAResponse = new Promise((resolve) => {
      resolveServerA = resolve;
    });
    const serverA = {
      id: "server-a",
      url: "https://a.example.test",
      token: "token-a",
    };
    const serverB = {
      id: "server-b",
      url: "https://b.example.test",
      token: "token-b",
    };
    getCurrentServerIdMock.mockReturnValue("server-a");
    getCurrentServerMock.mockReturnValue(serverA);
    apiMock.mockReturnValueOnce(serverAResponse).mockResolvedValueOnce({
      id: 42,
      email: "b@example.test",
      name: "Server B",
      role: "user",
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const requestAOptions = apiMock.mock.calls[0]?.[3] as RequestInit;

    getCurrentServerIdMock.mockReturnValue("server-b");
    getCurrentServerMock.mockReturnValue(serverB);
    act(() => {
      window.dispatchEvent(new CustomEvent("crate-server-store-change"));
    });

    expect(requestAOptions.signal?.aborted).toBe(true);
    expect(await screen.findByText("user:42")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveServerA({
        id: 41,
        email: "a@example.test",
        name: "Server A",
        role: "user",
      });
      await serverAResponse;
    });

    expect(screen.getByText("user:42")).toBeInTheDocument();
    expect(screen.queryByText("user:41")).not.toBeInTheDocument();
  });

  it("clears the old user and routes to login when switching to a tokenless server", async () => {
    const serverA = {
      id: "server-a",
      url: "https://a.example.test",
      token: "token-a",
    };
    const serverB = {
      id: "server-b",
      url: "https://b.example.test",
      token: null,
    };
    getCurrentServerIdMock.mockReturnValue("server-a");
    getCurrentServerMock.mockReturnValue(serverA);
    apiMock.mockResolvedValueOnce({
      id: 41,
      email: "a@example.test",
      name: "Server A",
      role: "user",
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("user:41")).toBeTruthy();

    getCurrentServerIdMock.mockReturnValue("server-b");
    getCurrentServerMock.mockReturnValue(serverB);
    act(() => {
      window.dispatchEvent(new CustomEvent("crate-server-store-change"));
    });

    expect(screen.getByText("anon")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("resets playback when two servers authenticate the same numeric user id", async () => {
    const authReset = vi.fn();
    const serverA = {
      id: "server-a",
      url: "https://a.example.test",
      token: "token-a",
    };
    const serverB = {
      id: "server-b",
      url: "https://b.example.test",
      token: "token-b",
    };
    getCurrentServerIdMock.mockReturnValue("server-a");
    getCurrentServerMock.mockReturnValue(serverA);
    apiMock
      .mockResolvedValueOnce({
        id: 42,
        email: "same-id@example.test",
        name: "Server A",
        role: "user",
      })
      .mockResolvedValueOnce({
        id: 42,
        email: "same-id@example.test",
        name: "Server B",
        role: "user",
      });
    localStorage.setItem("listen-player-state", '{"queue":["server-a"]}');
    window.addEventListener(AUTH_RUNTIME_RESET_EVENT, authReset);

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("user:42")).toBeTruthy();

    getCurrentServerIdMock.mockReturnValue("server-b");
    getCurrentServerMock.mockReturnValue(serverB);
    act(() => {
      window.dispatchEvent(new CustomEvent("crate-server-store-change"));
    });

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem("listen-player-state")).toBeNull();
    expect(authReset).toHaveBeenCalledTimes(1);
    expect((authReset.mock.calls[0]?.[0] as CustomEvent).detail.reason).toBe(
      "user-change",
    );
    window.removeEventListener(AUTH_RUNTIME_RESET_EVENT, authReset);
  });

  it("cleans session state and navigates to login on logout", async () => {
    const authReset = vi.fn();
    window.addEventListener(
      AUTH_RUNTIME_RESET_EVENT,
      authReset as EventListener,
    );
    apiMock
      .mockResolvedValueOnce({
        id: 11,
        email: "logout@example.test",
        name: "Logout",
        role: "user",
      })
      .mockResolvedValueOnce({});

    localStorage.setItem("listen-player-state", '{"queue":[]}');
    localStorage.setItem("listen-recently-played", "[]");
    localStorage.setItem("listen-player-state:v1", '{"queue":[{"id":"a"}]}');
    localStorage.setItem("listen-recently-played:v1", '[{"id":"a"}]');

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("user:11")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "logout" }));

    await waitFor(() => {
      expect(setAuthTokenMock).toHaveBeenCalledWith(null);
    });
    expect(apiMock).toHaveBeenCalledWith("/api/auth/logout", "POST");
    expect(localStorage.getItem("listen-player-state")).toBeNull();
    expect(localStorage.getItem("listen-recently-played")).toBeNull();
    expect(localStorage.getItem("listen-player-state:v1")).toBeNull();
    expect(localStorage.getItem("listen-recently-played:v1")).toBeNull();
    expect(localStorage.getItem("listen-auth-user-id")).toBeNull();
    expect(clearQueueMock).toHaveBeenCalled();
    expect(authReset).toHaveBeenCalledTimes(1);
    expect((authReset.mock.calls[0]?.[0] as CustomEvent).detail.reason).toBe(
      "logout",
    );
    expect(navigateMock).toHaveBeenCalledWith("/login");
    window.removeEventListener(
      AUTH_RUNTIME_RESET_EVENT,
      authReset as EventListener,
    );
  });

  it("rehydrates and navigates when the native OAuth event arrives", async () => {
    apiMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 9,
      email: "oauth@example.test",
      name: "OAuth",
      role: "user",
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("anon")).toBeTruthy();

    consumePendingOAuthNextMock.mockReturnValueOnce("/stats");
    window.dispatchEvent(new CustomEvent("crate:auth-token-received"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/stats", { replace: true });
    });
    expect(apiMock.mock.calls.some(([url]) => url === "/api/auth/me")).toBe(
      true,
    );
  });

  it("does not navigate pending OAuth when rehydration remains unauthenticated", async () => {
    apiMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("anon")).toBeTruthy();

    consumePendingOAuthNextMock.mockReturnValueOnce("/stats");
    window.dispatchEvent(new CustomEvent("crate:auth-token-received"));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledTimes(2);
    });
    expect(navigateMock).not.toHaveBeenCalledWith("/stats", {
      replace: true,
    });
  });
});
