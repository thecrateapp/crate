// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LinuxWindowTitlebar } from "./LinuxWindowTitlebar";

const native = vi.hoisted(() => ({
  minimize: vi.fn().mockResolvedValue(undefined),
  maximize: vi.fn().mockResolvedValue(undefined),
  unmaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  startDragging: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "native.window.minimize": "Minimize window",
        "native.window.maximize": "Maximize or restore window",
        "native.window.close": "Close window",
      })[key],
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete document.documentElement.dataset.crateLinuxWindowButtonLayout;
});

describe("Linux chrome runtime", () => {
  it("routes buttons and drag separately without browser title tooltips", async () => {
    const unlisten = vi.fn();
    native.onResized.mockResolvedValue(unlisten);
    const { container, unmount } = render(<LinuxWindowTitlebar />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Maximize or restore window" }),
    );
    await waitFor(() => expect(native.maximize).toHaveBeenCalledOnce());
    expect(native.minimize).toHaveBeenCalledOnce();
    expect(native.close).toHaveBeenCalledOnce();
    expect(native.startDragging).not.toHaveBeenCalled();
    fireEvent.mouseDown(
      container.querySelector('[data-slot="window-drag-region"]')!,
      { buttons: 1, detail: 1 },
    );
    expect(native.startDragging).toHaveBeenCalledOnce();
    expect(container.querySelector("[title]")).toBeNull();
    unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("observes placement changes and cleans a late resize subscription", async () => {
    let resolve!: (unlisten: () => void) => void;
    const unlisten = vi.fn();
    native.onResized.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { container, unmount } = render(<LinuxWindowTitlebar />);
    document.documentElement.dataset.crateLinuxWindowButtonLayout =
      "close:minimize,maximize";
    await waitFor(() =>
      expect(
        container
          .querySelector("[data-window-control]")
          ?.getAttribute("data-window-control"),
      ).toBe("close"),
    );
    unmount();
    resolve(unlisten);
    await waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
    expect(
      document.documentElement.dataset.crateLinuxWindowMaximized,
    ).toBeUndefined();
  });
});
