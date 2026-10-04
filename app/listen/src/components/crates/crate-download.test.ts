import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  assign: vi.fn(),
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: mocks.api,
    apiSseUrl: (path: string) => path,
  };
});

vi.mock("@/lib/library-routes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/library-routes")>(
    "@/lib/library-routes",
  );
  return { ...actual, downloadApiUrl: (path: string) => `https://api${path}` };
});

vi.mock("@crate/ui/lib/notify", () => ({ notify: mocks.toast }));

import {
  CRATE_DOWNLOAD_TIMEOUT_MS,
  crateDownloadProgress,
  startCrateDownload,
} from "@/components/crates/crate-download";

class MockEventSource {
  static instances: MockEventSource[] = [];
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = 1;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(
      type,
      listener as unknown as (event: MessageEvent<string>) => void,
    );
  }

  emit(type: string, payload: unknown) {
    this.listeners.get(type)?.({
      data: JSON.stringify(payload),
    } as MessageEvent<string>);
  }
}

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction;
const crate = { id: "crate-1", name: "Year-end records" };
const crateBId = "crate-2";

describe("startCrateDownload", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.assign.mockReset();
    Object.values(mocks.toast).forEach((fn) => fn.mockReset());
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("location", { ...window.location, assign: mocks.assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads a cached ZIP immediately", async () => {
    mocks.api.mockResolvedValueOnce({
      status: "ready",
      download_url: "/api/crates/crate-1/download/abc",
      filename: "Year-end records.zip",
      task_id: null,
    });

    await startCrateDownload(crate, t);

    expect(mocks.api).toHaveBeenCalledWith(
      "/api/crates/crate-1/download",
      "POST",
    );
    expect(mocks.assign).toHaveBeenCalledWith(
      "https://api/api/crates/crate-1/download/abc",
    );
    expect(mocks.toast.loading).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("tracks a pending build over SSE and downloads when it completes", async () => {
    mocks.api.mockResolvedValueOnce({
      status: "pending",
      task_id: "task-9",
      filename: "Year-end records.zip",
      download_url: null,
    });

    await startCrateDownload(crate, t);
    await startCrateDownload(crate, t);

    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.instances[0]!;
    expect(source.url).toBe("/api/events/task/task-9");
    expect(mocks.toast.loading).toHaveBeenCalledWith(
      expect.stringContaining("crate.download.preparing"),
      expect.objectContaining({
        id: "crate-download:crate-1",
        duration: Infinity,
      }),
    );

    source.emit("progress", {
      id: 4,
      type: "progress",
      data: { phase: "packaging", done: 10, total: 40, percent: 25 },
    });
    expect(mocks.toast.loading).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        id: "crate-download:crate-1",
        description: 'crate.download.progress:{"progress":25}',
      }),
    );

    source.emit("task_done", {
      status: "completed",
      result: { download_url: "/api/crates/crate-1/download/def" },
    });

    await vi.waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith(
        "https://api/api/crates/crate-1/download/def",
      ),
    );
    expect(source.close).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "crate.download.ready",
      expect.objectContaining({ id: "crate-download:crate-1" }),
    );
  });

  it("shows an error toast when the build fails and allows retrying", async () => {
    mocks.api.mockResolvedValue({ status: "pending", task_id: "task-3" });
    const failing = { id: crateBId, name: "Broken" };

    await startCrateDownload(failing, t);
    MockEventSource.instances[0]!.emit("task_done", {
      status: "failed",
      error: "boom",
    });

    await vi.waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "crate.download.failed",
        expect.objectContaining({ id: `crate-download:${crateBId}` }),
      ),
    );
    expect(mocks.assign).not.toHaveBeenCalled();

    await startCrateDownload(failing, t);
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it("shows an error toast when the request is rejected", async () => {
    mocks.api.mockRejectedValueOnce(new Error("404"));

    await startCrateDownload({ id: "crate-3", name: "Empty" }, t);

    expect(mocks.toast.error).toHaveBeenCalledWith(
      "crate.download.failed",
      expect.objectContaining({ id: "crate-download:crate-3" }),
    );
  });
});

describe("startCrateDownload polling fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.api.mockReset();
    mocks.assign.mockReset();
    Object.values(mocks.toast).forEach((fn) => fn.mockReset());
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("location", { ...window.location, assign: mocks.assign });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries transient polling errors with backoff and completes", async () => {
    mocks.api
      .mockResolvedValueOnce({ status: "pending", task_id: "task-poll-1" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ status: "running", progress: { percent: 50 } })
      .mockResolvedValueOnce({
        status: "completed",
        result: { download_url: "/api/crates/poll-1/download/zip" },
      });

    await startCrateDownload({ id: "poll-1", name: "Polling" }, t);
    await vi.advanceTimersByTimeAsync(4000 + 8000 + 2000);

    expect(mocks.api).toHaveBeenCalledTimes(5);
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.assign).toHaveBeenCalledWith(
      "https://api/api/crates/poll-1/download/zip",
    );
  });

  it("fails after repeated consecutive polling errors", async () => {
    mocks.api
      .mockResolvedValueOnce({ status: "pending", task_id: "task-poll-2" })
      .mockRejectedValue(new Error("offline"));

    await startCrateDownload({ id: "poll-2", name: "Polling" }, t);
    await vi.advanceTimersByTimeAsync(4000 + 8000 + 16000 + 30000);

    expect(mocks.api).toHaveBeenCalledTimes(6);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "crate.download.failed",
      expect.objectContaining({ id: "crate-download:poll-2" }),
    );
  });

  it("times out a build that never finishes", async () => {
    mocks.api
      .mockResolvedValueOnce({ status: "pending", task_id: "task-poll-3" })
      .mockResolvedValue({ status: "running" });

    await startCrateDownload({ id: "poll-3", name: "Polling" }, t);
    await vi.advanceTimersByTimeAsync(CRATE_DOWNLOAD_TIMEOUT_MS + 2000);

    expect(mocks.toast.error).toHaveBeenCalledWith(
      "crate.download.timedOut",
      expect.objectContaining({ id: "crate-download:poll-3" }),
    );
  });
});

describe("startCrateDownload SSE timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.api.mockReset();
    Object.values(mocks.toast).forEach((fn) => fn.mockReset());
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("closes the stream and shows a timeout error after the worker limit", async () => {
    mocks.api.mockResolvedValueOnce({ status: "pending", task_id: "task-sse" });

    await startCrateDownload({ id: "sse-1", name: "Slow" }, t);
    await vi.advanceTimersByTimeAsync(CRATE_DOWNLOAD_TIMEOUT_MS);

    expect(MockEventSource.instances[0]!.close).toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "crate.download.timedOut",
      expect.objectContaining({ id: "crate-download:sse-1" }),
    );
  });
});

describe("crateDownloadProgress", () => {
  it("reads replayed and live progress envelopes", () => {
    expect(crateDownloadProgress({ data: { percent: 42.4 } })).toBe(42);
    expect(
      crateDownloadProgress({
        task_id: "t",
        event_type: "progress",
        data: { done: 3, total: 4 },
      }),
    ).toBe(75);
    expect(crateDownloadProgress('{"percent": 10}')).toBe(10);
    expect(crateDownloadProgress(null)).toBeNull();
  });
});
