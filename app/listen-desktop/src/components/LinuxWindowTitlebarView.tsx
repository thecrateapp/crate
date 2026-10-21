import type { MouseEventHandler } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import "./linux-window-titlebar.css";

export type WindowControl = "minimize" | "maximize" | "close";
export interface WindowButtonLayout {
  left: WindowControl[];
  right: WindowControl[];
}

export interface LinuxWindowTitlebarViewProps {
  layout: WindowButtonLayout;
  labels: Record<WindowControl, string>;
  onAction: (control: WindowControl) => void;
  onDrag: MouseEventHandler<HTMLDivElement>;
}

/** Native window dots retain their compact geometry and GNOME placement. This
 * chrome is desktop-only, rather than another conventional Listen action row. */
export function LinuxWindowTitlebarView({
  layout,
  labels,
  onAction,
  onDrag,
}: LinuxWindowTitlebarViewProps) {
  function controls(items: WindowControl[]) {
    if (!items.length) return null;
    return (
      <div className="relative z-10 flex h-full shrink-0 items-center px-1">
        {items.map((control) => (
          <TooltipHint content={labels[control]} key={control}>
            <button
              aria-label={labels[control]}
              className="group flex h-full w-7 items-center justify-center"
              onClick={() => onAction(control)}
              type="button"
            >
              <span
                className="listen-desktop-window-control-dot relative grid size-[13px] place-items-center rounded-full"
                data-window-control={control}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 8 8"
                  className="absolute size-[7px] text-black/75 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                >
                  <path
                    d={
                      control === "close"
                        ? "M1 1 7 7M7 1 1 7"
                        : control === "minimize"
                          ? "M1 4H7"
                          : "M1 1H7V7H1Z"
                    }
                  />
                </svg>
              </span>
            </button>
          </TooltipHint>
        ))}
      </div>
    );
  }
  return (
    <div
      data-slot="linux-window-titlebar"
      className="relative flex h-9 shrink-0 items-center border-b border-border-quiet bg-surface-canvas text-text-secondary"
    >
      {controls(layout.left)}
      <div
        aria-hidden="true"
        data-slot="window-drag-region"
        className="relative h-full min-w-0 flex-1"
        onMouseDown={onDrag}
      />
      <MonoLabel
        as="span"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 select-none"
      >
        Crate
      </MonoLabel>
      {controls(layout.right)}
    </div>
  );
}
