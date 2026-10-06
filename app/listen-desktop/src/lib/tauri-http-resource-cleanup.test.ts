import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

afterEach(() => {
  invokeMock.mockReset();
});

function setupResponse(status: number, responseRid = 22): void {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "plugin:http|fetch") return 11;
    if (command === "plugin:http|fetch_send") {
      return {
        status,
        statusText: "OK",
        headers: [],
        url: "https://api.example.test/resource",
        rid: responseRid,
      };
    }
    return undefined;
  });
}

describe("Tauri HTTP resource cleanup", () => {
  it("closes the native body resource for responses without a body", async () => {
    setupResponse(204);
    const controller = new AbortController();

    const response = await tauriFetch("https://api.example.test/resource", {
      signal: controller.signal,
    });
    controller.abort();

    expect(response.body).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("plugin:http|fetch_cancel_body", {
      rid: 22,
    });
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "plugin:http|fetch_cancel",
      ),
    ).toHaveLength(0);
  });

  it("closes a partially consumed native body once when cancelled", async () => {
    setupResponse(200);
    const response = await tauriFetch("https://api.example.test/resource");

    await response.body?.cancel();

    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "plugin:http|fetch_cancel_body",
      ),
    ).toHaveLength(1);
  });

  it("removes the request abort listener when fetching response headers fails", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "plugin:http|fetch") return 11;
      if (command === "plugin:http|fetch_send") {
        throw new Error("network failure");
      }
      return undefined;
    });
    const controller = new AbortController();

    await expect(
      tauriFetch("https://api.example.test/resource", {
        signal: controller.signal,
      }),
    ).rejects.toThrow("network failure");
    controller.abort();

    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "plugin:http|fetch_cancel",
      ),
    ).toHaveLength(0);
  });
});

describe("Tauri HTTP request bodies", () => {
  it("sends JSON PUT bodies to the native client and resolves the error response", async () => {
    const payload = { name: "Crate", is_ordered: true, sort_direction: "asc" };
    const errorBody = new TextEncoder().encode('{"detail":"Unprocessable"}');
    let bodyRead = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "plugin:http|fetch") return 11;
      if (command === "plugin:http|fetch_send") {
        return {
          status: 422,
          statusText: "Unprocessable Entity",
          headers: [["content-type", "application/json"]],
          url: "https://api.example.test/api/crates/1",
          rid: 22,
        };
      }
      if (command === "plugin:http|fetch_read_body") {
        if (bodyRead) return new Uint8Array([1]).buffer;
        bodyRead = true;
        return new Uint8Array([...errorBody, 0]).buffer;
      }
      return undefined;
    });

    const response = await tauriFetch("https://api.example.test/api/crates/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const [, { clientConfig }] = invokeMock.mock.calls.find(
      ([command]) => command === "plugin:http|fetch",
    )!;
    expect(clientConfig.method).toBe("PUT");
    expect(clientConfig.headers).toContainEqual([
      "content-type",
      "application/json",
    ]);
    expect(new TextDecoder().decode(new Uint8Array(clientConfig.data))).toBe(
      JSON.stringify(payload),
    );
    expect(response.status).toBe(422);
    await expect(response.text()).resolves.toBe('{"detail":"Unprocessable"}');
  });
});
