import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  redactUrl,
  recordDevLog,
  getDevLogs,
  getDevLogsSnapshot,
  clearDevLogs,
  DEV_LOG_EVENT,
} from "./dev-logs";

beforeEach(() => {
  clearDevLogs();
});

describe("redactUrl", () => {
  it("redacts token query param in a URL", () => {
    expect(redactUrl("https://example.com/api?token=secret123")).toBe(
      "https://example.com/api?token=redacted",
    );
  });

  it("redacts token in raw string via regex", () => {
    expect(redactUrl("/api/foo?token=abc&other=1")).toBe(
      "/api/foo?token=redacted&other=1",
    );
  });

  it("redacts media tickets from complete and raw URLs", () => {
    expect(
      redactUrl("https://example.com/stream?media_ticket=secret123&other=1"),
    ).toBe("https://example.com/stream?media_ticket=redacted&other=1");
    expect(redactUrl("/stream?media_ticket=secret123&other=1")).toBe(
      "/stream?media_ticket=redacted&other=1",
    );
  });

  it("returns value unchanged when no token", () => {
    expect(redactUrl("https://example.com/api")).toBe(
      "https://example.com/api",
    );
  });
});

describe("recordDevLog / getDevLogs / clearDevLogs", () => {
  it("records and retrieves a log", () => {
    recordDevLog("test", "hello");
    const logs = getDevLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.scope).toBe("test");
    expect(logs[0]!.message).toBe("hello");
    expect(logs[0]!.level).toBe("info");
  });

  it("dispatches a custom event asynchronously", async () => {
    const handler = vi.fn();
    window.addEventListener(DEV_LOG_EVENT, handler);
    recordDevLog("test", "evt");
    expect(handler).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(DEV_LOG_EVENT, handler);
  });

  it("clears all logs", () => {
    recordDevLog("test", "a");
    clearDevLogs();
    expect(getDevLogs()).toHaveLength(0);
  });

  it("stores detail as string when object", () => {
    recordDevLog("test", "msg", { foo: 1 });
    const logs = getDevLogs();
    expect(logs[0]!.detail).toBe('{"foo":1}');
  });

  it("redacts credentials embedded in logged URL details", () => {
    recordDevLog("test", "stream", {
      path: "https://example.com/stream?media_ticket=secret123&token=secret456",
    });
    expect(getDevLogs()[0]!.detail).toBe(
      '{"path":"https://example.com/stream?media_ticket=redacted&token=redacted"}',
    );
  });

  it("sanitizes stored logs without changing the external-store snapshot", () => {
    delete window.__crateDevLogs;
    window.localStorage.setItem(
      "crate-dev-logs",
      JSON.stringify([
        {
          id: 1,
          timestamp: 1,
          level: "info",
          scope: "test",
          message: "stream",
          detail: "https://example.com/stream?media_ticket=old-secret",
        },
      ]),
    );

    const firstSnapshot = getDevLogsSnapshot();
    const secondSnapshot = getDevLogsSnapshot();

    expect(secondSnapshot).toBe(firstSnapshot);
    expect(firstSnapshot[0]!.detail).toBe(
      "https://example.com/stream?media_ticket=redacted",
    );
    expect(window.localStorage.getItem("crate-dev-logs")).not.toContain(
      "old-secret",
    );
  });

  it("respects max log limit", () => {
    for (let i = 0; i < 205; i++) {
      recordDevLog("test", String(i));
    }
    expect(getDevLogs()).toHaveLength(200);
  });
});
