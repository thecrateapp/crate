import { useState } from "react";
import { renderWithListenProviders as render } from "@/test/render-with-listen-providers";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TauriDevLogPanelView } from "./TauriDevLogPanelView";
import { TauriDevLogPanel } from "./TauriDevLogPanel";
import { clearDevLogs, DEV_LOG_EVENT, recordDevLog } from "@/lib/dev-logs";
const runtime = vi.hoisted(() => ({ tauri: true }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  get isTauriRuntime() {
    return runtime.tauri;
  },
}));

describe("Tauri diagnostic presentation", () => {
  beforeEach(() => {
    runtime.tauri = true;
    clearDevLogs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it.each(["web", "production"])(
    "does not render or subscribe in %s",
    (host) => {
      if (host === "web") runtime.tauri = false;
      else vi.stubEnv("DEV", false);
      const listen = vi.spyOn(window, "addEventListener");
      const { container } = render(<TauriDevLogPanel />);
      expect(container).toBeEmptyDOMElement();
      expect(
        listen.mock.calls.filter(([event]) => event === DEV_LOG_EVENT),
      ).toHaveLength(0);
    },
  );
  it("releases its subscription after opening and closing the panel", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<TauriDevLogPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Logs · 0" }));
    expect(
      screen.getByRole("region", { name: "Tauri playback logs" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(
      screen.queryByRole("region", { name: "Tauri playback logs" }),
    ).not.toBeInTheDocument();
    unmount();
    expect(remove.mock.calls.some(([event]) => event === DEV_LOG_EVENT)).toBe(
      true,
    );
  });
  it("keeps the real log store, ordering and clear action", async () => {
    clearDevLogs();
    recordDevLog("output", "First event");
    recordDevLog("audio", "Second event", "Output ready");
    render(<TauriDevLogPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Logs · 2" }));
    const panel = screen.getByRole("region", { name: "Tauri playback logs" });
    expect(within(panel).getAllByRole("listitem")[0]).toHaveTextContent(
      "Second event",
    );
    const detail = within(panel).getByRole("region", { name: "Second event" });
    detail.focus();
    expect(detail).toHaveFocus();
    fireEvent.click(within(panel).getByRole("button", { name: "Clear" }));
    expect(within(panel).getByText("No playback events yet.")).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Clear" })).toBeDisabled();
  });
  it("hides on Escape and returns focus to its toggle", () => {
    const onClear = vi.fn();
    function Fixture() {
      const [open, setOpen] = useState(true);
      return (
        <TauriDevLogPanelView
          logs={[]}
          open={open}
          onOpenChange={setOpen}
          onClear={onClear}
        />
      );
    }
    render(<Fixture />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Hide" }), {
      key: "Escape",
    });
    expect(
      screen.queryByRole("region", { name: "Tauri playback logs" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs · 0" })).toHaveFocus();
    expect(onClear).not.toHaveBeenCalled();
  });
});
