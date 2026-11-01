import { describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { createApiClient, ApiError } from "../../../shared/web/api";

describe("createApiClient", () => {
  it("returns data on successful GET", async () => {
    const client = createApiClient();
    const data = { id: 1, name: "Test" };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
      headers: new Headers(),
    });

    const result = await client("/api/test");
    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws ApiError on non-ok response", async () => {
    const client = createApiClient();

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      headers: new Headers(),
    });

    await expect(client("/api/test")).rejects.toThrow(ApiError);
  });

  it("exposes the X-Crate-Error code on API errors", async () => {
    const client = createApiClient();

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: async () => "Conflict",
      headers: new Headers({ "X-Crate-Error": "AI_CONFIGURATION_CONFLICT" }),
    });

    try {
      await client("/api/test");
      throw new Error("expected client to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).code).toBe("AI_CONFIGURATION_CONFLICT");
    }
  });

  it("calls onUnauthorized for 401 responses", async () => {
    const onUnauthorized = vi.fn();
    const client = createApiClient({ onUnauthorized });

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      headers: new Headers(),
    });

    await expect(client("/api/test")).rejects.toThrow(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("api onUnauthorized", () => {
  it("keeps an authenticated Admin page when a stricter endpoint rejects its session", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/ai", search: "", hash: "", href: "/ai" },
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async (url: string) =>
          new Response(
            url === "/api/auth/me"
              ? JSON.stringify({ id: 1 })
              : "Human cookie session required",
            { status: url === "/api/auth/me" ? 200 : 401 },
          ),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(api("/api/admin/agent-plans/summary")).rejects.toMatchObject(
        { status: 401 },
      );
      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/auth/me",
          expect.objectContaining({
            credentials: "same-origin",
            cache: "no-store",
          }),
        ),
      );
      expect(window.location.href).toBe("/ai");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
      vi.unstubAllGlobals();
    }
  });

  it.each([401, 503, "network"] as const)(
    "redirects only for an expired session, not a transient %s check",
    async (status) => {
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          pathname: "/ai",
          search: "?tab=providers",
          hash: "#models",
          href: "/ai",
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async (url: string) => {
          if (url === "/api/auth/me" && status === "network")
            throw new TypeError("Network unavailable");
          return new Response("Unavailable", {
            status:
              url === "/api/auth/me" && typeof status === "number"
                ? status
                : 401,
          });
        }),
      );
      try {
        await expect(
          api("/api/admin/agent-plans/summary"),
        ).rejects.toMatchObject({ status: 401 });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(window.location.href).toBe(
          status === 401
            ? "/login?redirect=%2Fai%3Ftab%3Dproviders%23models"
            : "/ai",
        );
      } finally {
        Object.defineProperty(window, "location", {
          configurable: true,
          value: originalLocation,
        });
        vi.unstubAllGlobals();
      }
    },
  );

  it("shares one session check across concurrent endpoint failures", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/ai", href: "/ai" },
    });
    let finishCheck!: (response: Response) => void;
    const check = new Promise<Response>((resolve) => {
      finishCheck = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string) =>
        url === "/api/auth/me"
          ? check
          : new Response("Unauthorized", { status: 401 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await Promise.allSettled([
        api("/api/admin/agent-plans/summary"),
        api("/api/admin/agent-integrations"),
      ]);
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/auth/me"),
      ).toHaveLength(1);
      finishCheck(new Response(JSON.stringify({ id: 1 })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(window.location.href).toBe("/ai");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
      vi.unstubAllGlobals();
    }
  });

  it("does not redirect or recheck the session from the login page", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/login", href: "/login" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })),
    );
    try {
      await expect(api("/api/auth/me")).rejects.toMatchObject({ status: 401 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(window.location.href).toBe("/login");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
      vi.unstubAllGlobals();
    }
  });
});

describe("Admin api client", () => {
  it("identifies Admin traffic for request metrics without an app session id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "{}",
      headers: new Headers(),
    });

    await api("/api/admin/ops-snapshot");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.headers).toMatchObject({ "X-Crate-Client": "admin-web" });
    expect(init?.headers).not.toHaveProperty("X-Crate-App");
  });
});
