import { beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(() => "success-id"),
  error: vi.fn(() => "error-id"),
  info: vi.fn(() => "info-id"),
  loading: vi.fn(() => "loading-id"),
  dismiss: vi.fn(),
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

    expect(toastMock.success).toHaveBeenCalledWith("Saved");
    expect(toastMock.error).toHaveBeenCalledWith("Failed");
    expect(toastMock.info).toHaveBeenCalledWith("Heads up");
    expect(toastMock.success.mock.calls[0]).toHaveLength(1);
  });

  it("shows loading toasts with id and duration", () => {
    expect(
      notify.loading("Preparing", {
        id: "download",
        description: "Queued",
        duration: Infinity,
      }),
    ).toBe("loading-id");

    expect(toastMock.loading).toHaveBeenCalledWith("Preparing", {
      id: "download",
      description: "Queued",
      duration: Infinity,
    });
  });

  it("dismisses a single toast or all toasts", () => {
    notify.dismiss("download");
    notify.dismiss();

    expect(toastMock.dismiss).toHaveBeenNthCalledWith(1, "download");
    expect(toastMock.dismiss.mock.calls[1]).toHaveLength(0);
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
