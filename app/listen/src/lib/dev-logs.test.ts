import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  redactUrl,
  recordDevLog,
  getDevLogs,
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

  it("dispatches a custom event", () => {
    const handler = vi.fn();
    window.addEventListener(DEV_LOG_EVENT, handler);
    recordDevLog("test", "evt");
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

  it("respects max log limit", () => {
    for (let i = 0; i < 205; i++) {
      recordDevLog("test", String(i));
    }
    expect(getDevLogs()).toHaveLength(200);
  });
});
