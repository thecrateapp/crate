import { setWindowInactive } from "@crate/ui/lib/motion-gate";

/** The slice of Tauri's window API the activity bridge needs. */
export interface WindowActivitySource {
  isFocused(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  onFocusChanged(
    handler: (event: { payload: boolean }) => void,
  ): Promise<() => void>;
  onResized(handler: () => void): Promise<() => void>;
}

/**
 * Mirror the native window's focus and minimised state into the motion gate.
 *
 * WebKitGTK keeps `document.visibilityState` at "visible" while the window is
 * behind others, on another workspace or minimised, so decorative loops (the
 * player-bar analyser, the spinning disc, lyric underlines) never paused and
 * kept the web process busy at the panel's refresh rate. Audio is untouched:
 * only loops that already consult the motion gate stop.
 *
 * Any failure leaves the window active, so the shell never freezes motion by
 * mistake.
 */
export async function trackWindowActivity(
  source: WindowActivitySource,
  setInactive: (inactive: boolean) => void = setWindowInactive,
): Promise<() => void> {
  let focused = true;
  let minimized = false;
  let focusEvents = 0;
  let minimizedQuery = 0;
  let disposed = false;

  const apply = () => {
    if (!disposed) setInactive(!focused || minimized);
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
      await source.onFocusChanged(({ payload }) => {
        focusEvents += 1;
        focused = payload !== false;
        apply();
        // Restoring a minimised window focuses it; re-read the state then.
        if (focused) void refreshMinimized();
      }),
    );
    unlisteners.push(
      await source.onResized(() => {
        void refreshMinimized();
      }),
    );
    const eventsBeforeQuery = focusEvents;
    const initiallyFocused = await source.isFocused().catch(() => true);
    // A focus event that arrived meanwhile is newer than the query result.
    if (focusEvents === eventsBeforeQuery) focused = initiallyFocused;
    await refreshMinimized();
    apply();
  } catch {
    focused = true;
    minimized = false;
    apply();
  }

  return () => {
    disposed = true;
    unlisteners.forEach((unlisten) => unlisten());
    setInactive(false);
  };
}

export async function initWindowActivityBridge(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await trackWindowActivity(getCurrentWindow());
  } catch {
    setWindowInactive(false);
  }
}
