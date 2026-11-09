// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLimiter, RemoteRequestError, requestWithRetry } from "./github-preview-fetch";

const url = "https://raw.githubusercontent.com/thecrateapp/crate/0123/app/main.py";
const text = (response: Response) => response.text();
function harness(...responses: (Response | Error | (() => Promise<Response>))[]) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  });
  const sleep = vi.fn(async () => {});
  return { fetch, sleep, options: { fetch: fetch as unknown as typeof globalThis.fetch, sleep, random: () => 0.5 } };
}

describe("remote requests with retries", () => {
  it("retries transient statuses and network failures with exponential backoff", async () => {
    const { fetch, sleep, options } = harness(
      new Response("busy", { status: 503 }),
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }),
      new Response("source"),
    );
    await expect(requestWithRetry(url, {}, text, options)).resolves.toBe("source");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[750], [1500]]);
  });

  it("waits for the server's Retry-After on rate limits, within the cap", async () => {
    const { sleep, options } = harness(
      new Response("slow down", { status: 429, headers: { "Retry-After": "7" } }),
      new Response("slow down", { status: 429, headers: { "Retry-After": "600" } }),
      new Response("source"),
    );
    await expect(requestWithRetry(url, {}, text, { ...options, maxDelayMs: 30_000 })).resolves.toBe("source");
    expect(sleep.mock.calls).toEqual([[7000], [30_000]]);
  });

  it("fails at once on a definitive answer such as 404 and keeps the status", async () => {
    const { fetch, sleep, options } = harness(new Response("Not found", { status: 404 }));
    const failure = requestWithRetry(url, {}, text, options);
    await expect(failure).rejects.toBeInstanceOf(RemoteRequestError);
    await expect(failure).rejects.toMatchObject({ status: 404, message: `GET ${url} failed: HTTP 404` });
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the last attempt with the URL, attempt count and cause", async () => {
    const { fetch, sleep, options } = harness(...Array.from({ length: 4 }, () => new Response("down", { status: 502 })));
    await expect(requestWithRetry(url, { method: "POST" }, text, options))
      .rejects.toThrow(`POST ${url} failed after 4 attempts: HTTP 502`);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("retries a body that fails mid-read and a request that times out", async () => {
    const { fetch, options } = harness(
      () => new Promise<Response>((_resolve, reject) => setTimeout(() => reject(new DOMException("timeout", "TimeoutError")), 1)),
      new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } })),
      new Response("complete"),
    );
    await expect(requestWithRetry(url, {}, text, options)).resolves.toBe("complete");
    expect(fetch).toHaveBeenCalledTimes(3);
    const timedOut = harness(...Array.from({ length: 2 }, () => () => Promise.reject(new DOMException("timeout", "TimeoutError"))));
    await expect(requestWithRetry(url, {}, text, { ...timedOut.options, attempts: 2, timeoutMs: 50 }))
      .rejects.toThrow("failed after 2 attempts: timed out after 50 ms");
  });

  it("passes a per-attempt timeout signal to every request", async () => {
    const { fetch, options } = harness(new Response("source"));
    await requestWithRetry(url, { headers: { Accept: "text/plain" } }, text, options);
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ headers: { Accept: "text/plain" }, signal: expect.any(AbortSignal) }));
  });
});

describe("request concurrency", () => {
  it("never runs more than the bound at once and completes every task in order", async () => {
    const limit = createLimiter(3);
    let active = 0, peak = 0;
    const started: number[] = [];
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => limit(async () => {
      started.push(index);
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, index % 3));
      active--;
      if (index === 4) throw new Error("one task fails");
      return index;
    }).catch((error: Error) => error.message)));
    expect(peak).toBe(3);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(results[4]).toBe("one task fails");
    expect(results.filter((value) => typeof value === "number")).toHaveLength(9);
    // A failed task releases its slot as well.
    await expect(limit(async () => "after")).resolves.toBe("after");
  });
});
