import { setWindowHidden } from "@crate/ui/lib/motion-gate";

/** What the bridge needs from Tauri: window state plus the shell's verdict. */
export interface WindowVisibilitySource {
  isMinimized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
  /** The compositor's answer: true on screen, false hidden, null unknown. */
  queryVisibility(): Promise<boolean | null>;
  onVisibilityChanged(handler: (visible: boolean) => void): Promise<() => void>;
}

/**
 * Mirror "is the window on screen" into the motion gate.
 *
 * WebKitGTK keeps `document.visibilityState` at "visible" and keeps running
 * requestAnimationFrame and CSS animations while the window sits on a
 * workspace no monitor shows (measured: rAF 60/s, animations advancing). The
 * Rust shell asks the compositor (Hyprland IPC) and reports it here; a
 * minimised window counts as hidden too. Focus does not matter: a visible
 * window on another monitor keeps animating. Unknown means visible, and any
 * failure leaves motion on, so the bridge can never freeze a visible window.
 */
export async function trackWindowVisibility(
  source: WindowVisibilitySource,
  setHidden: (hidden: boolean) => void = setWindowHidden,
): Promise<() => void> {
  let compositorHidden = false;
  let minimized = false;
  let visibilityEvents = 0;
  let minimizedQuery = 0;
  let disposed = false;

  const apply = () => {
    if (!disposed) setHidden(compositorHidden || minimized);
  };
  const refreshMinimized = async () => {
    const query = ++minimizedQuery;
    let next = false;
    try {
      next = await source.isMinimized();
    } catch {
      next = false;
    }
    if (query !== minimizedQuery) return;
    minimized = next;
    apply();
  };

  const unlisteners: Array<() => void> = [];
  try {
    unlisteners.push(
      await source.onVisibilityChanged((visible) => {
        visibilityEvents += 1;
        compositorHidden = visible === false;
        apply();
        if (visible) void refreshMinimized();
      }),
    );
    unlisteners.push(
      await source.onResized(() => {
        void refreshMinimized();
      }),
    );
    const eventsBeforeQuery = visibilityEvents;
    const initial = await source.queryVisibility().catch(() => null);
    // An event that arrived meanwhile is newer than the query result.
    if (visibilityEvents === eventsBeforeQuery)
      compositorHidden = initial === false;
    await refreshMinimized();
    apply();
  } catch {
    compositorHidden = false;
    minimized = false;
    apply();
  }

  return () => {
    disposed = true;
    unlisteners.forEach((unlisten) => unlisten());
    setHidden(false);
  };
}

export async function initWindowVisibilityBridge(): Promise<void> {
  try {
    const [{ getCurrentWindow }, { listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);
    const appWindow = getCurrentWindow();
    await trackWindowVisibility({
      isMinimized: () => appWindow.isMinimized(),
      onResized: (handler) => appWindow.onResized(handler),
      queryVisibility: () =>
        invoke<boolean | null>("desktop_window_visibility"),
      onVisibilityChanged: (handler) =>
        listen<boolean>("crate:window-visibility", (event) =>
          handler(event.payload !== false),
        ),
    });
  } catch {
    setWindowHidden(false);
  }
}
