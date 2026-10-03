import { beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(() => "success-id"),
  error: vi.fn(() => "error-id"),
  info: vi.fn(() => "info-id"),
  promise: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import { notify } from "./notify";

describe("notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards success, error and info to sonner", () => {
    expect(notify.success("Saved")).toBe("success-id");
    expect(notify.error("Failed")).toBe("error-id");
    expect(notify.info("Heads up")).toBe("info-id");

    expect(toastMock.success).toHaveBeenCalledWith("Saved", undefined);
    expect(toastMock.error).toHaveBeenCalledWith("Failed", undefined);
    expect(toastMock.info).toHaveBeenCalledWith("Heads up", undefined);
  });

  it("passes id and description so repeated toasts deduplicate", () => {
    notify.error("Offline", { id: "network", description: "Retrying" });

    expect(toastMock.error).toHaveBeenCalledWith("Offline", {
      id: "network",
      description: "Retrying",
    });
  });

  it("omits undefined options instead of overriding sonner defaults", () => {
    notify.success("Saved", { id: undefined, description: undefined });

    expect(toastMock.success).toHaveBeenCalledWith("Saved", {});
  });

  it("wraps promises and returns the original result", async () => {
    const messages = {
      loading: "Saving",
      success: "Saved",
      error: "Failed",
    };

    await expect(
      notify.promise(Promise.resolve(42), messages, { id: "save" }),
    ).resolves.toBe(42);
    expect(toastMock.promise).toHaveBeenCalledWith(expect.any(Promise), {
      id: "save",
      ...messages,
    });
  });

  it("accepts a promise factory", async () => {
    const factory = vi.fn(() => Promise.resolve("done"));

    await expect(
      notify.promise(factory, { loading: "A", success: "B", error: "C" }),
    ).resolves.toBe("done");
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
