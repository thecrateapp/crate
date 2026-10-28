import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeTaskEvent, useTaskEvents } from "./use-task-events";

class TestEventSource {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  listeners: Record<string, (event: MessageEvent) => void> = {};
  close = vi.fn();

  constructor(readonly url: string) {
    taskEventSources.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners[type] = listener;
  }

  dispatch(type: string, payload: unknown) {
    this.listeners[type]?.(
      new MessageEvent(type, { data: JSON.stringify(payload) }),
    );
  }
}

let taskEventSources: TestEventSource[] = [];

function taskEventSource(index = 0) {
  const source = taskEventSources[index];
  if (!source) throw new Error(`Missing task event source at index ${index}`);
  return source;
}

function TaskEventProbe({ taskId, label }: { taskId: string; label: string }) {
  const { events, connected, done } = useTaskEvents(taskId);
  return (
    <output aria-label={label}>
      {`${events.length}:${connected}:${events[0]?.data.message ?? ""}:${done?.status ?? ""}`}
    </output>
  );
}

beforeEach(() => {
  taskEventSources = [];
  vi.stubGlobal("EventSource", TestEventSource);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("normalizeTaskEvent", () => {
  it("uses the SSE event name when the payload has no type", () => {
    const event = normalizeTaskEvent(
      {
        id: 42,
        timestamp: "2026-05-21T10:00:00Z",
        message: "Repair complete",
      },
      "step_done",
    );

    expect(event).toEqual({
      id: 42,
      type: "step_done",
      timestamp: "2026-05-21T10:00:00Z",
      data: { message: "Repair complete" },
    });
  });

  it("keeps structured data and falls back safely for malformed payloads", () => {
    expect(
      normalizeTaskEvent(
        {
          type: "item",
          data: { action: "delete_track", target: "01.flac" },
        },
        "info",
      ),
    ).toMatchObject({
      id: 0,
      type: "item",
      data: { action: "delete_track", target: "01.flac" },
    });

    expect(normalizeTaskEvent(null, "warning")).toMatchObject({
      id: 0,
      type: "warning",
      data: {},
    });
  });
});

describe("useTaskEvents", () => {
  it("resets only the consumer that asked, not every view of the task", () => {
    function ResettableProbe() {
      const { events, done, reset } = useTaskEvents("shared-reset");
      return (
        <button type="button" onClick={reset}>
          {`${events.length}:${done?.status ?? ""}`}
        </button>
      );
    }
    render(
      <>
        <ResettableProbe />
        <TaskEventProbe taskId="shared-reset" label="other consumer" />
      </>,
    );

    act(() => {
      taskEventSource().dispatch("task_event", { id: 1, type: "info", data: {} });
    });
    act(() => screen.getByRole("button").click());

    expect(screen.getByRole("button")).toHaveTextContent(/^0:$/);
    expect(screen.getByLabelText("other consumer")).toHaveTextContent(/^1:/);
  });

  it("keeps one copy of each event when a reconnect replays recent history", () => {
    vi.useFakeTimers();
    render(<TaskEventProbe taskId="replayed-task" label="consumer" />);

    act(() => {
      taskEventSource(0).onopen?.(new Event("open"));
      taskEventSource(0).dispatch("task_event", {
        id: 1,
        type: "info",
        data: { message: "Started" },
      });
      taskEventSource(0).dispatch("task_event", { id: 2, type: "info", data: {} });
      taskEventSource(0).onerror?.(new Event("error"));
      vi.advanceTimersByTime(5000);
    });
    expect(taskEventSources).toHaveLength(2);

    act(() => {
      taskEventSource(1).dispatch("task_event", {
        id: 1,
        type: "info",
        data: { message: "Started" },
      });
      taskEventSource(1).dispatch("task_event", { id: 2, type: "info", data: {} });
      taskEventSource(1).dispatch("task_event", { id: 3, type: "info", data: {} });
    });

    expect(screen.getByLabelText("consumer")).toHaveTextContent(
      /^3:(true|false):Started:$/,
    );
  });

  it("shares and fans out one task stream, then closes it after the last consumer leaves", () => {
    const { rerender, unmount } = render(
      <>
        <TaskEventProbe taskId="shared-task" label="first consumer" />
        <TaskEventProbe taskId="shared-task" label="second consumer" />
      </>,
    );

    expect(taskEventSources).toHaveLength(1);
    expect(taskEventSource().url).toBe(
      "/api/events/task/shared-task?generic=1",
    );

    act(() => {
      taskEventSource().onopen?.(new Event("open"));
      taskEventSource().dispatch("task_event", {
        type: "progress",
        data: { message: "Still working" },
      });
    });

    expect(screen.getByLabelText("first consumer")).toHaveTextContent(
      "1:true:Still working:",
    );
    expect(screen.getByLabelText("second consumer")).toHaveTextContent(
      "1:true:Still working:",
    );

    rerender(<TaskEventProbe taskId="shared-task" label="first consumer" />);
    expect(taskEventSource().close).not.toHaveBeenCalled();

    unmount();
    expect(taskEventSource().close).toHaveBeenCalledOnce();
  });

  it("opens independent streams for different task IDs and closes on task_done", () => {
    render(
      <>
        <TaskEventProbe taskId="task-a" label="task A" />
        <TaskEventProbe taskId="task-b" label="task B" />
      </>,
    );

    expect(taskEventSources.map(({ url }) => url)).toEqual([
      "/api/events/task/task-a?generic=1",
      "/api/events/task/task-b?generic=1",
    ]);

    act(() =>
      taskEventSource(0).dispatch("task_done", { status: "completed" }),
    );

    expect(screen.getByLabelText("task A")).toHaveTextContent(
      "0:false::completed",
    );
    expect(taskEventSource(0).close).toHaveBeenCalledOnce();
    expect(taskEventSource(1).close).not.toHaveBeenCalled();
  });

  it("reconnects a failed stream after five seconds while consumers remain", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <TaskEventProbe taskId="retry-task" label="retry consumer" />,
    );

    act(() => taskEventSource().onerror?.(new Event("error")));
    expect(taskEventSource().close).toHaveBeenCalledOnce();
    expect(taskEventSources).toHaveLength(1);

    act(() => vi.advanceTimersByTime(4999));
    expect(taskEventSources).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(taskEventSources).toHaveLength(2);
    expect(taskEventSource(1).url).toBe(
      "/api/events/task/retry-task?generic=1",
    );

    act(() => unmount());
    expect(taskEventSource(1).close).toHaveBeenCalledOnce();
  });

  it("cancels the retry when the last consumer leaves", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <TaskEventProbe taskId="cancel-retry-task" label="retry consumer" />,
    );

    act(() => taskEventSource().onerror?.(new Event("error")));
    act(() => unmount());
    act(() => vi.advanceTimersByTime(5000));

    expect(taskEventSources).toHaveLength(1);
    expect(taskEventSource().close).toHaveBeenCalledOnce();
  });
});
