import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, type LucideIcon } from "lucide-react";

type WindowControl = "minimize" | "maximize" | "close";

interface WindowButtonLayout {
  left: WindowControl[];
  right: WindowControl[];
}

const DEFAULT_BUTTON_LAYOUT: WindowButtonLayout = {
  left: [],
  right: ["minimize", "maximize", "close"],
};

const WINDOW_CONTROLS: Record<
  WindowControl,
  { label: string; Icon: LucideIcon }
> = {
  minimize: {
    label: "Minimize window",
    Icon: Minus,
  },
  maximize: {
    label: "Maximize or restore window",
    Icon: Square,
  },
  close: {
    label: "Close window",
    Icon: X,
  },
};

const WINDOW_BUTTON_LAYOUT_ATTRIBUTE = "data-crate-linux-window-button-layout";
type WindowSizeActions = Pick<
  ReturnType<typeof getCurrentWindow>,
  "isMaximized" | "maximize" | "unmaximize"
>;

export function LinuxWindowTitlebar() {
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
    <div className="listen-desktop-window-titlebar fixed inset-x-0 top-0 flex h-9 shrink-0 items-center border-b border-border-quiet bg-surface-canvas/82 text-text-secondary backdrop-blur-sm">
      <WindowControls
        controls={layout.left}
        window={currentWindow}
        onToggleMaximize={toggleWindowSize}
      />
      <div
        aria-hidden="true"
        className="relative h-full min-w-0 flex-1"
        onMouseDown={(event) => {
          if (event.buttons !== 1) return;
          if (event.detail === 2) {
            event.preventDefault();
            void toggleWindowSize();
          } else {
            void currentWindow.startDragging();
          }
        }}
      />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 select-none text-xs font-medium text-text-secondary">
        Crate
      </span>
      <WindowControls
        controls={layout.right}
        window={currentWindow}
        onToggleMaximize={toggleWindowSize}
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

function WindowControls({
  controls,
  window,
  onToggleMaximize,
}: {
  controls: WindowControl[];
  window: ReturnType<typeof getCurrentWindow>;
  onToggleMaximize: () => Promise<void>;
}) {
  if (!controls.length) return null;

  return (
    <div className="relative z-10 flex h-full shrink-0 items-center px-1">
      {controls.map((control) => {
        const { label, Icon } = WINDOW_CONTROLS[control];
        const runAction = {
          minimize: () => window.minimize(),
          maximize: onToggleMaximize,
          close: () => window.close(),
        }[control];

        return (
          <button
            key={control}
            aria-label={label}
            className="group flex h-full w-7 items-center justify-center"
            onClick={() => void runAction()}
            title={label}
            type="button"
          >
            <span
              className="listen-desktop-window-control-dot relative grid size-[13px] place-items-center rounded-full"
              data-window-control={control}
            >
              <Icon
                aria-hidden="true"
                className="absolute size-[7px] text-black/75 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                strokeWidth={2.5}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
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
