import { beforeEach, describe, expect, it, vi } from "vitest";

const { secureGet, secureRemove, secureSet } = vi.hoisted(() => ({
  secureGet: vi.fn(),
  secureRemove: vi.fn(),
  secureSet: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: true,
  isCapacitorRuntime: true,
}));

vi.mock("@/lib/native-secure-session", () => ({
  getSecureSessionValue: secureGet,
  setSecureSessionValue: secureSet,
  removeSecureSessionValue: secureRemove,
}));

describe("native server credential migration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("preserves the pre-upgrade server registry during native bootstrap", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          token: "access-secret",
          tokenExpiresAt: "2030-01-01T00:00:00Z",
          refreshToken: "refresh-secret",
        },
      ]),
    );
    localStorage.setItem("crate-current-server", "server-1");
    secureSet.mockResolvedValue(undefined);
    secureGet.mockResolvedValue(
      JSON.stringify({
        token: "access-secret",
        refreshToken: "refresh-secret",
      }),
    );
    const store = await import("./server-store");

    await store.bootstrapNativeSessionStore();

    expect(store.getCurrentServer()).toMatchObject({
      id: "server-1",
      token: "access-secret",
      refreshToken: "refresh-secret",
    });
    expect(localStorage.getItem("crate-servers")).not.toContain(
      "access-secret",
    );
    expect(localStorage.getItem("crate-servers:v1")).toBeNull();
  });

  it("moves legacy tokens to native secure storage before stripping metadata", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          token: "access-secret",
          tokenExpiresAt: "2030-01-01T00:00:00Z",
          refreshToken: "refresh-secret",
        },
      ]),
    );
    secureSet.mockResolvedValue(undefined);
    secureGet.mockResolvedValue(
      JSON.stringify({
        token: "access-secret",
        refreshToken: "refresh-secret",
      }),
    );
    const store = await import("./server-store");

    await store.bootstrapNativeSessionStore();

    expect(secureSet).toHaveBeenCalledWith(
      "crate.session.server-1",
      JSON.stringify({
        token: "access-secret",
        refreshToken: "refresh-secret",
      }),
    );
    expect(store.getServers()[0]).toMatchObject({
      token: "access-secret",
      refreshToken: "refresh-secret",
    });
    expect(localStorage.getItem("crate-servers")).not.toContain(
      "access-secret",
    );
    expect(localStorage.getItem("crate-servers")).not.toContain(
      "refresh-secret",
    );
  });

  it("preserves legacy credentials when secure verification fails", async () => {
    const legacy = JSON.stringify([
      {
        id: "server-1",
        label: "Crate",
        url: "https://api.example.com",
        token: "access-secret",
        tokenExpiresAt: null,
        refreshToken: "refresh-secret",
      },
    ]);
    localStorage.setItem("crate-servers", legacy);
    secureSet.mockRejectedValue(new Error("keystore unavailable"));
    const store = await import("./server-store");

    await expect(store.bootstrapNativeSessionStore()).rejects.toThrow(
      "Native session migration failed",
    );

    expect(localStorage.getItem("crate-servers")).toBe(legacy);
  });

  it("loads an existing secure session into memory before React renders", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          tokenExpiresAt: null,
        },
      ]),
    );
    secureGet.mockResolvedValue(
      JSON.stringify({
        token: "access-secret",
        refreshToken: "refresh-secret",
      }),
    );
    const store = await import("./server-store");

    await store.bootstrapNativeSessionStore();

    expect(store.getServers()[0]).toMatchObject({
      token: "access-secret",
      refreshToken: "refresh-secret",
    });
  });

  it("keeps the pre-server token until secure migration is verified", async () => {
    localStorage.setItem("crate-auth-token", "access-secret");
    secureSet.mockResolvedValue(undefined);
    secureGet.mockResolvedValue(
      JSON.stringify({
        token: "access-secret",
        refreshToken: null,
      }),
    );
    const store = await import("./server-store");

    store.migrateLegacyToken("https://api.example.com");

    expect(localStorage.getItem("crate-auth-token")).toBe("access-secret");
    expect(localStorage.getItem("crate-servers")).toContain("access-secret");

    await store.bootstrapNativeSessionStore();

    expect(store.getCurrentServer()?.token).toBe("access-secret");
    expect(localStorage.getItem("crate-auth-token")).toBeNull();
    expect(localStorage.getItem("crate-servers")).not.toContain(
      "access-secret",
    );
  });

  it("surfaces secure persistence failures to the login flow", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          tokenExpiresAt: null,
        },
      ]),
    );
    localStorage.setItem("crate-current-server", "server-1");
    secureGet.mockResolvedValue(null);
    secureSet.mockRejectedValue(new Error("keystore unavailable"));
    const store = await import("./server-store");
    await store.bootstrapNativeSessionStore();

    store.setCurrentServerAuthTokens("access-secret", "refresh-secret");

    await expect(store.waitForPendingSecureSessionWrites()).rejects.toThrow(
      "Native session persistence failed",
    );
  });

  it("retries failed secure-session deletion during the next bootstrap", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          tokenExpiresAt: null,
        },
      ]),
    );
    localStorage.setItem("crate-current-server", "server-1");
    secureGet.mockResolvedValue(null);
    secureRemove.mockRejectedValueOnce(new Error("keystore unavailable"));
    const firstStore = await import("./server-store");
    await firstStore.bootstrapNativeSessionStore();

    firstStore.removeServer("server-1");
    await expect(
      firstStore.waitForPendingSecureSessionWrites(),
    ).rejects.toThrow("Native session persistence failed");
    expect(localStorage.getItem("crate-pending-session-removals:v1")).toContain(
      "server-1",
    );

    secureRemove.mockResolvedValue(undefined);
    vi.resetModules();
    const restartedStore = await import("./server-store");
    await restartedStore.bootstrapNativeSessionStore();

    expect(secureRemove).toHaveBeenLastCalledWith("crate.session.server-1");
    expect(
      localStorage.getItem("crate-pending-session-removals:v1"),
    ).toBeNull();
  });

  it("does not rehydrate a secure session while its removal is pending", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          tokenExpiresAt: null,
        },
      ]),
    );
    localStorage.setItem(
      "crate-pending-session-removals:v1",
      JSON.stringify({ "server-1": 1 }),
    );
    secureRemove.mockRejectedValue(new Error("keystore unavailable"));
    secureGet.mockResolvedValue(
      JSON.stringify({
        token: "logged-out-access",
        refreshToken: "logged-out-refresh",
      }),
    );
    const store = await import("./server-store");

    await store.bootstrapNativeSessionStore();

    expect(store.getServers()[0]).toMatchObject({
      token: null,
      refreshToken: null,
    });
    expect(secureGet).not.toHaveBeenCalledWith("crate.session.server-1");
    expect(localStorage.getItem("crate-pending-session-removals:v1")).toContain(
      "server-1",
    );
  });

  it("does not let a failed logout tombstone delete a later login", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          tokenExpiresAt: null,
        },
      ]),
    );
    localStorage.setItem("crate-current-server", "server-1");
    secureGet.mockResolvedValue(null);
    secureRemove.mockRejectedValueOnce(new Error("keystore unavailable"));
    secureSet.mockResolvedValue(undefined);
    const store = await import("./server-store");
    await store.bootstrapNativeSessionStore();

    store.setCurrentServerAuthTokens(null, null, null);
    await expect(store.waitForPendingSecureSessionWrites()).rejects.toThrow(
      "Native session persistence failed",
    );
    expect(localStorage.getItem("crate-pending-session-removals:v1")).toContain(
      "server-1",
    );

    store.setCurrentServerAuthTokens("new-access", "new-refresh", null);
    await store.waitForPendingSecureSessionWrites();

    expect(secureSet).toHaveBeenLastCalledWith(
      "crate.session.server-1",
      JSON.stringify({ token: "new-access", refreshToken: "new-refresh" }),
    );
    expect(
      localStorage.getItem("crate-pending-session-removals:v1"),
    ).toBeNull();
  });

  it("keeps a newer logout tombstone when an older login write completes", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          tokenExpiresAt: null,
        },
      ]),
    );
    localStorage.setItem("crate-current-server", "server-1");
    secureGet.mockResolvedValue(null);
    let resolveLoginWrite: (() => void) | undefined;
    secureSet.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLoginWrite = resolve;
      }),
    );
    let rejectLogoutRemoval: ((error: Error) => void) | undefined;
    secureRemove.mockReturnValue(
      new Promise<void>((_, reject) => {
        rejectLogoutRemoval = reject;
      }),
    );
    const store = await import("./server-store");
    await store.bootstrapNativeSessionStore();

    store.setCurrentServerAuthTokens("access-secret", "refresh-secret");
    await vi.waitFor(() => expect(secureSet).toHaveBeenCalledOnce());
    store.setCurrentServerAuthTokens(null, null, null);

    resolveLoginWrite!();
    await vi.waitFor(() => expect(secureRemove).toHaveBeenCalledOnce());

    expect(localStorage.getItem("crate-pending-session-removals:v1")).toContain(
      "server-1",
    );

    rejectLogoutRemoval!(new Error("keystore unavailable"));
    await expect(store.waitForPendingSecureSessionWrites()).rejects.toThrow(
      "Native session persistence failed",
    );
    expect(localStorage.getItem("crate-pending-session-removals:v1")).toContain(
      "server-1",
    );
  });
});
