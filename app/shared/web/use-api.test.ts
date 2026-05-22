import { useCallback, useEffect, useRef, useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUseApi } from "./use-api";

const originalFetch = globalThis.fetch;

function mockApiSuccess(data: unknown) {
  return vi.fn(() => Promise.resolve(data));
}

function mockApiError(message: string) {
  return vi.fn(() => Promise.reject(new Error(message)));
}

function mockApiAbort() {
  return vi.fn(
    () =>
      new Promise((_, reject) => {
        reject(new DOMException("The request was aborted", "AbortError"));
      }),
  );
}

// biome-ignore lint/suspicious/noExplicitAny: test file
function makeUseApi(apiFn: any) {
  return createUseApi({ useState, useEffect, useCallback, useRef }, apiFn);
}

describe("createUseApi", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("returns loading true initially when url is provided", async () => {
    const apiFn = mockApiSuccess({ items: [1, 2] });
    const useApi = makeUseApi(apiFn);

    const { result } = renderHook(() => useApi("/api/data"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("returns loading false when url is null", async () => {
    const apiFn = mockApiSuccess({});
    const useApi = makeUseApi(apiFn);

    const { result } = renderHook(() => useApi(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("fetches data and sets loading to false", async () => {
    const apiFn = mockApiSuccess({ items: [1, 2] });
    const useApi = makeUseApi(apiFn);

    const { result } = renderHook(() => useApi("/api/data"));
    await act(() => vi.runAllTimersAsync());

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ items: [1, 2] });
    expect(result.current.error).toBeNull();
  });

  it("sets error on fetch failure", async () => {
    const apiFn = mockApiError("Network error");
    const useApi = makeUseApi(apiFn);

    const { result } = renderHook(() => useApi("/api/fail"));
    await act(() => vi.runAllTimersAsync());

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Network error");
    expect(result.current.data).toBeNull();
  });

  it("ignores abort errors", async () => {
    const apiFn = mockApiAbort();
    const useApi = makeUseApi(apiFn);

    const { result } = renderHook(() => useApi("/api/data"));
    await act(() => vi.runAllTimersAsync());

    expect(result.current.error).toBeNull();
  });

  it("refetch triggers a new request", async () => {
    const apiFn = vi
      .fn()
      .mockResolvedValueOnce({ first: true })
      .mockResolvedValueOnce({ second: true });
    const useApi = makeUseApi(apiFn);

    const { result } = renderHook(() => useApi("/api/data"));
    await act(() => vi.runAllTimersAsync());

    expect(result.current.data).toEqual({ first: true });

    act(() => result.current.refetch());
    await act(() => vi.runAllTimersAsync());

    expect(apiFn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ second: true });
  });

  it("resets hasFetched when url changes", async () => {
    const apiFn = vi
      .fn()
      .mockResolvedValueOnce({ page: "a" })
      .mockResolvedValueOnce({ page: "b" });
    const useApi = makeUseApi(apiFn);

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useApi(url),
      { initialProps: { url: "/api/a" } },
    );
    await act(() => vi.runAllTimersAsync());

    expect(result.current.data).toEqual({ page: "a" });

    rerender({ url: "/api/b" });
    await act(() => vi.runAllTimersAsync());

    expect(apiFn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ page: "b" });
  });

  it("aborts previous request when url changes", async () => {
    const apiFn = vi.fn(
      (
        _url: string,
        _method: string,
        _body: unknown,
        options?: { signal?: AbortSignal },
      ) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const useApi = makeUseApi(apiFn);

    const { rerender } = renderHook(({ url }: { url: string }) => useApi(url), {
      initialProps: { url: "/api/a" },
    });

    rerender({ url: "/api/b" });
    await act(() => vi.runAllTimersAsync());

    // Both calls happened; the first should have been aborted
    expect(apiFn).toHaveBeenCalledTimes(2);
  });

  it("passes method and body to the API function", async () => {
    const apiFn = vi.fn(() => Promise.resolve({ created: true }));
    const useApi = makeUseApi(apiFn);

    const { result } = renderHook(() =>
      useApi("/api/create", "POST", { name: "test" }),
    );
    await act(() => vi.runAllTimersAsync());

    expect(apiFn).toHaveBeenCalledWith(
      "/api/create",
      "POST",
      { name: "test" },
      expect.any(Object),
    );
    expect(result.current.data).toEqual({ created: true });
  });

  it("returns a stable refetch reference", async () => {
    const apiFn = mockApiSuccess({});
    const useApi = makeUseApi(apiFn);

    const { result, rerender } = renderHook(() => useApi("/api/data"));
    const refetchA = result.current.refetch;

    rerender();
    const refetchB = result.current.refetch;

    expect(refetchA).toBe(refetchB);
  });
});
