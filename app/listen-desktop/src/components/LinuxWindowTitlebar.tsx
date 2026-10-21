import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import {
  LinuxWindowTitlebarView,
  type WindowButtonLayout,
  type WindowControl,
} from "./LinuxWindowTitlebarView";

const DEFAULT_BUTTON_LAYOUT: WindowButtonLayout = {
  left: [],
  right: ["minimize", "maximize", "close"],
};

const WINDOW_BUTTON_LAYOUT_ATTRIBUTE = "data-crate-linux-window-button-layout";
type WindowSizeActions = Pick<
  ReturnType<typeof getCurrentWindow>,
  "isMaximized" | "maximize" | "unmaximize"
>;

export function LinuxWindowTitlebar() {
  const { t } = useTranslation();
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [layout, setLayout] = useState(readWindowButtonLayout);
  const windowActionInProgressRef = useRef(false);

  const toggleWindowSize = useCallback(async () => {
    if (windowActionInProgressRef.current) return;
    windowActionInProgressRef.current = true;

    try {
      await toggleLinuxWindowSize(
        currentWindow,
        () => window.__crateTauriInvoke?.("ensure_desktop_window_size"),
      );
    } catch {
      // The resize listener will restore the correct shape after a failed action.
    } finally {
      windowActionInProgressRef.current = false;
    }
  }, [currentWindow]);

  useEffect(() => {
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    const updateMaximizedState = async () => {
      try {
        const maximized = await currentWindow.isMaximized();
        if (disposed) return;

        setWindowMaximizedAttribute(maximized);
      } catch {
        // Keep the rounded window shape if the platform cannot report state.
      }
    };

    const scheduleMaximizedStateUpdate = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => void updateMaximizedState(), 120);
    };

    void updateMaximizedState();
    void currentWindow
      .onResized(scheduleMaximizedStateUpdate)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenResize = unlisten;
        }
      })
      .catch(() => {
        // The compositor can reject resize subscriptions while a window closes.
      });

    const observer = new MutationObserver(() => {
      setLayout(readWindowButtonLayout());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [WINDOW_BUTTON_LAYOUT_ATTRIBUTE],
    });
    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      unlistenResize?.();
      observer.disconnect();
      delete document.documentElement.dataset.crateLinuxWindowMaximized;
    };
  }, [currentWindow]);

  return (
    <div className="listen-desktop-window-titlebar fixed inset-x-0 top-0">
      <LinuxWindowTitlebarView
        layout={layout}
        labels={{
          minimize: t("native.window.minimize"),
          maximize: t("native.window.maximize"),
          close: t("native.window.close"),
        }}
        onAction={(control) => {
          const action =
            control === "maximize"
              ? toggleWindowSize
              : control === "minimize"
                ? () => currentWindow.minimize()
                : () => currentWindow.close();
          void action().catch(() => {
            // A window action may race the compositor closing this webview.
          });
        }}
        onDrag={(event) => {
          if (event.buttons !== 1) return;
          if (event.detail === 2) {
            event.preventDefault();
            void toggleWindowSize();
          } else {
            void currentWindow.startDragging().catch(() => {});
          }
        }}
      />
    </div>
  );
}

export async function toggleLinuxWindowSize(
  currentWindow: WindowSizeActions,
  ensureWindowBounds: () => Promise<unknown> | undefined,
): Promise<void> {
  if (await currentWindow.isMaximized()) {
    await currentWindow.unmaximize();
    setWindowMaximizedAttribute(false);
    await ensureWindowBounds();
  } else {
    await currentWindow.maximize();
    setWindowMaximizedAttribute(true);
  }
}

function setWindowMaximizedAttribute(maximized: boolean) {
  if (maximized) {
    document.documentElement.dataset.crateLinuxWindowMaximized = "true";
  } else {
    delete document.documentElement.dataset.crateLinuxWindowMaximized;
  }
}

export function readWindowButtonLayout(): WindowButtonLayout {
  const value = document.documentElement.dataset.crateLinuxWindowButtonLayout;
  if (!value) return DEFAULT_BUTTON_LAYOUT;

  const separator = value.indexOf(":");
  const hasSides = separator >= 0;
  const leftValue = hasSides ? value.slice(0, separator) : "";
  const rightValue = hasSides ? value.slice(separator + 1) : value;
  const left = parseWindowControls(leftValue);
  const right = parseWindowControls(rightValue);

  if (left.length === 0 && right.length === 0) return DEFAULT_BUTTON_LAYOUT;
  if (!left.includes("close") && !right.includes("close")) right.push("close");

  return { left, right };
}

export function parseWindowControls(value: string): WindowControl[] {
  return value
    .split(",")
    .map((control) => control.trim().toLowerCase())
    .filter(
      (control): control is WindowControl =>
        control === "minimize" || control === "maximize" || control === "close",
    )
    .filter((control, index, controls) => controls.indexOf(control) === index);
}
