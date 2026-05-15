import { describe, expect, it, vi } from "vitest";
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
