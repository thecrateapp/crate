import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseWindowControls,
  readWindowButtonLayout,
  toggleLinuxWindowSize,
} from "./LinuxWindowTitlebar";

beforeEach(() => {
  vi.stubGlobal("document", {
    documentElement: { dataset: {} },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseWindowControls", () => {
  it("normalizes, filters, and deduplicates controls", () => {
    expect(
      parseWindowControls(" CLOSE, minimize,unknown,close, MAXIMIZE "),
    ).toEqual(["close", "minimize", "maximize"]);
  });
});

describe("readWindowButtonLayout", () => {
  it("uses the default layout when the desktop setting is absent", () => {
    expect(readWindowButtonLayout()).toEqual({
      left: [],
      right: ["minimize", "maximize", "close"],
    });
  });

  it("falls back when a setting contains no known controls", () => {
    document.documentElement.dataset.crateLinuxWindowButtonLayout =
      "unknown:also-unknown";

    expect(readWindowButtonLayout()).toEqual({
      left: [],
      right: ["minimize", "maximize", "close"],
    });
  });

  it("supports one-sided layouts and always keeps a close control", () => {
    document.documentElement.dataset.crateLinuxWindowButtonLayout =
      "minimize,maximize";

    expect(readWindowButtonLayout()).toEqual({
      left: [],
      right: ["minimize", "maximize", "close"],
    });
  });

  it("preserves both sides and deduplicates each side", () => {
    document.documentElement.dataset.crateLinuxWindowButtonLayout =
      "close,close:minimize,minimize";

    expect(readWindowButtonLayout()).toEqual({
      left: ["close"],
      right: ["minimize"],
    });
  });
});

describe("toggleLinuxWindowSize", () => {
  it("restores the native saved bounds without replacing them", async () => {
    const currentWindow = {
      isMaximized: vi.fn().mockResolvedValue(true),
      unmaximize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      setSize: vi.fn().mockResolvedValue(undefined),
      center: vi.fn().mockResolvedValue(undefined),
    };
    const ensureWindowBounds = vi.fn().mockResolvedValue(undefined);

    await toggleLinuxWindowSize(currentWindow, ensureWindowBounds);

    expect(currentWindow.unmaximize).toHaveBeenCalledOnce();
    expect(currentWindow.setSize).not.toHaveBeenCalled();
    expect(currentWindow.center).not.toHaveBeenCalled();
    expect(ensureWindowBounds).toHaveBeenCalledOnce();
  });

  it("maximizes without running restore-bound correction", async () => {
    const currentWindow = {
      isMaximized: vi.fn().mockResolvedValue(false),
      unmaximize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
    };
    const ensureWindowBounds = vi.fn().mockResolvedValue(undefined);

    await toggleLinuxWindowSize(currentWindow, ensureWindowBounds);

    expect(currentWindow.maximize).toHaveBeenCalledOnce();
    expect(ensureWindowBounds).not.toHaveBeenCalled();
  });
});
