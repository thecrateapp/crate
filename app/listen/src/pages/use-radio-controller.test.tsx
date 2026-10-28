import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRadioController } from "./use-radio-controller";
import type { RadioSearchResponse, SearchResult } from "./radio-model";

const mocks = vi.hoisted(() => ({
  api: vi.fn<(url: string, method?: string) => Promise<unknown>>(),
  useApi: vi.fn(),
  playAll: vi.fn(),
  checkDiscoveryAvailable: vi.fn(),
  startShapedRadio: vi.fn(),
  notifyError: vi.fn(),
  t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: mocks.api };
});
vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({ playAll: mocks.playAll }),
}));
vi.mock("@/lib/radio", () => ({
  checkDiscoveryAvailable: mocks.checkDiscoveryAvailable,
  startShapedRadio: mocks.startShapedRadio,
}));
vi.mock("@crate/ui/lib/notify", () => ({
  notify: { error: mocks.notifyError },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function artistResults(name: string): RadioSearchResponse {
  return { artists: [{ id: 7, name }], albums: [] };
}

async function elapse(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
}

const seed: SearchResult = {
  type: "genre",
  value: "hardcore",
  label: "Hardcore",
};

describe("useRadioController seed search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.useApi.mockReturnValue({
      data: { artist_stations: [], genre_stations: [] },
      loading: false,
      error: null,
    });
    mocks.checkDiscoveryAvailable.mockResolvedValue(false);
    mocks.startShapedRadio.mockResolvedValue({
      sessionId: "radio-session-1",
      seedLabel: "Hardcore",
      tracks: [],
      source: { type: "radio", name: "Hardcore Radio" },
    });
    mocks.api.mockImplementation(async (url) => {
      if (url === "/api/genres") return [];
      if (url.startsWith("/api/catalog/search?")) {
        return artistResults("High Vis");
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("updates the controlled query immediately without making a request", async () => {
    const { result } = renderHook(() => useRadioController());

    act(() => result.current.onQueryChange("hi"));

    expect(result.current.query).toBe("hi");
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.useApi).toHaveBeenCalledWith("/api/radio/stations");
    await elapse(299);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("waits 300 ms after the last change and requests genres only for the final search", async () => {
    const { result } = renderHook(() => useRadioController());

    act(() => result.current.onQueryChange("hi"));
    await elapse(200);
    act(() => result.current.onQueryChange("high"));
    await elapse(200);
    act(() => result.current.onQueryChange("high vis"));
    await elapse(299);
    expect(result.current.query).toBe("high vis");
    expect(mocks.api).not.toHaveBeenCalled();

    await elapse(1);

    expect(mocks.api.mock.calls.map(([url]) => url).sort()).toEqual([
      "/api/catalog/search?q=high%20vis&limit=5",
      "/api/genres",
    ]);
    expect(
      mocks.api.mock.calls.every(([, method]) => method === undefined),
    ).toBe(true);
    expect(result.current.results).toEqual([
      expect.objectContaining({ type: "artist", label: "High Vis" }),
    ]);
    expect(result.current.searching).toBe(false);
  });

  it.each(["", "h"])(
    "clears results immediately for %j and cancels the pending request",
    async (query) => {
      const { result } = renderHook(() => useRadioController());
      act(() => result.current.onQueryChange("high"));
      await elapse(300);
      expect(result.current.results).toHaveLength(1);
      mocks.api.mockClear();

      act(() => result.current.onQueryChange("converge"));
      await elapse(150);
      act(() => result.current.onQueryChange(query));

      expect(result.current.query).toBe(query);
      expect(result.current.results).toEqual([]);
      expect(result.current.searching).toBe(false);
      await elapse(1000);
      expect(mocks.api).not.toHaveBeenCalled();
    },
  );

  it("ignores an in-flight response after the query is cleared", async () => {
    const pending = deferred<RadioSearchResponse>();
    mocks.api.mockImplementation(async (url) =>
      url === "/api/genres" ? [] : pending.promise,
    );
    const { result } = renderHook(() => useRadioController());
    act(() => result.current.onQueryChange("high"));
    await elapse(300);
    expect(result.current.searching).toBe(true);

    act(() => result.current.onQueryChange(""));
    await act(async () => pending.resolve(artistResults("High Vis")));

    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(false);
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it("keeps the newer search pending when an older response arrives", async () => {
    const older = deferred<RadioSearchResponse>();
    const newer = deferred<RadioSearchResponse>();
    mocks.api.mockImplementation(async (url) => {
      if (url === "/api/genres") return [];
      return url.includes("q=high&") ? older.promise : newer.promise;
    });
    const { result } = renderHook(() => useRadioController());
    act(() => result.current.onQueryChange("high"));
    await elapse(300);
    act(() => result.current.onQueryChange("converge"));
    await elapse(300);

    await act(async () => older.resolve(artistResults("High Vis")));

    expect(result.current.query).toBe("converge");
    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(true);

    await act(async () => newer.resolve(artistResults("Converge")));

    expect(result.current.results).toEqual([
      expect.objectContaining({ label: "Converge" }),
    ]);
    expect(result.current.searching).toBe(false);
    expect(
      mocks.api.mock.calls.filter(([url]) => url === "/api/genres"),
    ).toHaveLength(2);
  });

  it("does not let an older failure clear a newer result", async () => {
    const older = deferred<RadioSearchResponse>();
    mocks.api.mockImplementation(async (url) => {
      if (url === "/api/genres") return [];
      return url.includes("q=high&")
        ? older.promise
        : artistResults("Converge");
    });
    const { result } = renderHook(() => useRadioController());
    act(() => result.current.onQueryChange("high"));
    await elapse(300);
    act(() => result.current.onQueryChange("converge"));
    await elapse(300);

    await act(async () => older.reject(new Error("stale request failed")));

    expect(result.current.results).toEqual([
      expect.objectContaining({ label: "Converge" }),
    ]);
    expect(result.current.searching).toBe(false);
  });

  it("settles a failed current request without leaving a loading state", async () => {
    mocks.api.mockRejectedValue(new Error("search unavailable"));
    const { result } = renderHook(() => useRadioController());
    act(() => result.current.onQueryChange("high"));

    await elapse(300);

    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(false);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(result.current.searchError).toBe(true);
    mocks.api.mockImplementation(async (url) =>
      url === "/api/genres" ? [] : artistResults("Recovered"),
    );
    act(() => result.current.retrySearch());
    await elapse(300);
    expect(result.current.searchError).toBe(false);
    expect(result.current.results[0]?.label).toBe("Recovered");
  });

  it("cancels a pending search when the hook unmounts", async () => {
    const { result, unmount } = renderHook(() => useRadioController());
    act(() => result.current.onQueryChange("high"));
    await elapse(299);

    unmount();
    await elapse(1000);

    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("cancels a pending search when a seed starts playback", async () => {
    const { result } = renderHook(() => useRadioController());
    act(() => result.current.onQueryChange("high"));
    await elapse(150);

    await act(async () => result.current.startSeeded(seed));
    await elapse(1000);

    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.startShapedRadio).toHaveBeenCalledWith(
      "seeded",
      "genre",
      "hardcore",
    );
    expect(mocks.playAll).toHaveBeenCalledOnce();
    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(result.current.activeSession).toBe("radio-session-1");
  });

  it("does not reopen results when an in-flight response arrives after seed selection", async () => {
    const pending = deferred<RadioSearchResponse>();
    mocks.api.mockImplementation(async (url) =>
      url === "/api/genres" ? [] : pending.promise,
    );
    const { result } = renderHook(() => useRadioController());
    act(() => result.current.onQueryChange("high"));
    await elapse(300);

    await act(async () => result.current.startSeeded(seed));
    await act(async () => pending.resolve(artistResults("High Vis")));

    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(false);
    expect(result.current.activeSession).toBe("radio-session-1");
    expect(mocks.playAll).toHaveBeenCalledOnce();
  });
});
