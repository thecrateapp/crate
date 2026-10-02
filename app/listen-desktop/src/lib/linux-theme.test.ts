import { afterEach, describe, expect, it, vi } from "vitest";

type ThemeSnapshot = {
  scheme?: string;
  accent?: string;
  gtkTheme?: string;
  windowButtonLayout?: string;
  iconTheme?: string;
  cursorTheme?: string;
  fontName?: string;
  textScale?: number;
  source?: string[];
};

function installLinuxDom(invoke: ReturnType<typeof vi.fn>) {
  const styleValues = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) =>
        styleValues.set(name, value),
      removeProperty: (name: string) => styleValues.delete(name),
    },
  };
  const fakeWindow = Object.assign(new EventTarget(), {
    __crateTauriInvoke: invoke,
  });
  const fakeDocument = Object.assign(new EventTarget(), {
    documentElement: root,
    visibilityState: "visible",
  });

  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("navigator", { userAgent: "Mozilla Linux" });

  return { fakeDocument, fakeWindow, root, styleValues };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Linux desktop theme refresh", () => {
  it("coalesces focus and visibility refreshes while one query is pending", async () => {
    let resolveSnapshot!: (snapshot: ThemeSnapshot) => void;
    const invoke = vi.fn(
      () =>
        new Promise<ThemeSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const { fakeDocument, fakeWindow, root } = installLinuxDom(invoke);
    const { initLinuxDesktopTheme } = await import("./linux-theme");

    initLinuxDesktopTheme();
    fakeWindow.dispatchEvent(new Event("focus"));
    fakeDocument.dispatchEvent(new Event("visibilitychange"));

    expect(invoke).toHaveBeenCalledTimes(1);
    resolveSnapshot({ scheme: "dark", source: ["portal"] });
    await Promise.resolve();

    expect(root.dataset.crateLinuxScheme).toBe("dark");
  });

  it("keeps cached fields when a later snapshot is partial", async () => {
    vi.useFakeTimers();
    const invoke = vi
      .fn<() => Promise<ThemeSnapshot | null>>()
      .mockResolvedValueOnce({
        scheme: "dark",
        accent: "#9141ac",
        fontName: "Inter 10",
        source: ["portal", "gsettings"],
      })
      .mockResolvedValueOnce({ scheme: "light", source: ["portal"] });
    const { fakeWindow, root, styleValues } = installLinuxDom(invoke);
    const { initLinuxDesktopTheme } = await import("./linux-theme");

    initLinuxDesktopTheme();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.dataset.crateLinuxScheme).toBe("dark");
    expect(styleValues.get("--crate-linux-accent")).toBe("#9141ac");
    expect(styleValues.get("--crate-linux-font-family")).toContain("Inter");

    fakeWindow.dispatchEvent(new Event("focus"));
    expect(invoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_001);
    fakeWindow.dispatchEvent(new Event("focus"));
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(root.dataset.crateLinuxScheme).toBe("light");
    expect(styleValues.get("--crate-linux-accent")).toBe("#9141ac");
    expect(styleValues.get("--crate-linux-font-family")).toContain("Inter");
  });

  it("keeps the last valid theme when the native bridge rejects", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const invoke = vi
      .fn<() => Promise<ThemeSnapshot | null>>()
      .mockResolvedValueOnce({ scheme: "dark", source: ["portal"] })
      .mockRejectedValueOnce(new Error("portal unavailable"));
    const { fakeWindow, root } = installLinuxDom(invoke);
    const { initLinuxDesktopTheme } = await import("./linux-theme");

    initLinuxDesktopTheme();
    await Promise.resolve();
    expect(root.dataset.crateLinuxScheme).toBe("dark");

    await vi.advanceTimersByTimeAsync(1_001);
    fakeWindow.dispatchEvent(new Event("focus"));
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(root.dataset.crateLinuxScheme).toBe("dark");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
