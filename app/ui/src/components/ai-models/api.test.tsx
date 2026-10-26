import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Enqueued, Job } from "./types";

const { apiMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { JobProgress } from "./api";

const JOB_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const accepted: Enqueued = { task_id: JOB_ID, deduplicated: false };

let job: Job | null;
let jobError: string | null;
const refetch = vi.fn();

function running(): Job {
  return { id: JOB_ID, status: "running", result: null };
}

function finished(status: string, result: Job["result"]): Job {
  return { id: JOB_ID, status, result };
}

beforeEach(() => {
  vi.useFakeTimers();
  job = running();
  jobError = null;
  refetch.mockReset();
  apiMock.mockReset();
  useApiMock.mockReset().mockImplementation((url: string | null) => ({
    data: url ? job : null,
    loading: false,
    error: url ? jobError : null,
    refetch,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderProgress(
  kind: "refresh" | "test",
  enqueued: Enqueued | null = accepted,
  onComplete = vi.fn(),
) {
  const view = render(
    <JobProgress job={enqueued} kind={kind} onComplete={onComplete} />,
  );
  const rerender = () =>
    view.rerender(
      <JobProgress job={enqueued} kind={kind} onComplete={onComplete} />,
    );
  return { ...view, rerender, onComplete };
}

describe("JobProgress", () => {
  it("polls a running refresh and reports the loaded models once", () => {
    const { rerender, onComplete, container } = renderProgress("refresh");

    expect(useApiMock).toHaveBeenCalledWith(`/api/admin/ai/jobs/${JOB_ID}`);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing models…");
    act(() => vi.advanceTimersByTime(1500));
    expect(refetch).toHaveBeenCalledTimes(1);

    job = finished("completed", { status: "succeeded", model_count: 12 });
    rerender();
    expect(screen.getByRole("status")).toHaveTextContent("Loaded 12 models");
    expect(onComplete).toHaveBeenCalledTimes(1);

    rerender();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(JOB_ID);
  });

  it("keeps the poll timer across a new inline onComplete and calls only the latest one", () => {
    const callbacks: ReturnType<typeof vi.fn>[] = [];
    const view = render(
      <JobProgress job={accepted} kind="refresh" onComplete={vi.fn()} />,
    );
    function rerenderWithFreshCallback() {
      const callback = vi.fn();
      callbacks.push(callback);
      view.rerender(
        <JobProgress job={accepted} kind="refresh" onComplete={callback} />,
      );
      return callback;
    }

    // A parent re-rendering every 500 ms with a brand-new inline onComplete
    // must not reset the 1500 ms poll timer.
    for (let tick = 0; tick < 6; tick++) {
      act(() => vi.advanceTimersByTime(500));
      rerenderWithFreshCallback();
    }
    expect(refetch).toHaveBeenCalled();

    job = finished("completed", { status: "succeeded", model_count: 3 });
    const latest = rerenderWithFreshCallback();

    expect(screen.getByRole("status")).toHaveTextContent("Loaded 3 models");
    expect(latest).toHaveBeenCalledTimes(1);
    for (const callback of callbacks.slice(0, -1)) {
      expect(callback).not.toHaveBeenCalled();
    }
  });

  it("reports a failed refresh, with or without a result", () => {
    job = finished("failed", { status: "failed", error_code: "AI_JOB_FAILED" });
    const { onComplete, unmount } = renderProgress("refresh");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't refresh models",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("AI_JOB_FAILED");
    expect(onComplete).toHaveBeenCalledTimes(1);
    unmount();

    job = finished("failed", null);
    renderProgress("refresh");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't refresh models",
    );
  });

  it("says a refresh or test is already running for a deduplicated request", () => {
    const deduplicated: Enqueued = { task_id: null, deduplicated: true };
    const { unmount } = renderProgress("refresh", deduplicated);

    expect(useApiMock).toHaveBeenCalledWith(null);
    expect(screen.getByRole("status")).toHaveTextContent(
      "A refresh is already running.",
    );
    unmount();

    renderProgress("test", deduplicated);
    expect(screen.getByRole("status")).toHaveTextContent(
      "A test is already running.",
    );
  });

  it.each([
    [running(), "Testing…"],
    [
      finished("completed", { status: "succeeded", compatible: true }),
      "Compatible",
    ],
    [
      finished("completed", { status: "succeeded", compatible: false }),
      "Not compatible",
    ],
    [finished("failed", { status: "failed", compatible: null }), "Test failed"],
    [finished("cancelled", null), "Test failed"],
  ])("shows the test outcome %#", (state, message) => {
    job = state;
    const { container } = renderProgress("test");

    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(container.textContent).not.toContain(JOB_ID);
  });

  it("stops polling when unmounted", () => {
    const { unmount } = renderProgress("refresh");
    unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(refetch).not.toHaveBeenCalled();
  });

  it("renders nothing without a job", () => {
    const { container } = renderProgress("refresh", null);
    expect(container).toBeEmptyDOMElement();
  });

  it("never shows a raw error body while reading the job", () => {
    jobError = '{"detail":"Job does not exist","code":"AI_JOB_UNKNOWN"}';
    job = null;
    renderProgress("refresh");

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "Couldn't check progress. Reload the page to see the latest state.",
    );
    expect(status).not.toHaveTextContent("detail");
    expect(status).not.toHaveTextContent("AI_JOB_UNKNOWN");
  });
});
