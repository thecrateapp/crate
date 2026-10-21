import { forwardRef, type ReactNode } from "react";
import { AppPopover } from "@crate/ui/primitives/AppPopover";

export const EqualizerAnchoredSurface = forwardRef<
  HTMLDivElement,
  { children: ReactNode; label: string }
>(function EqualizerAnchoredSurface({ children, label }, ref) {
  return (
    <AppPopover
      ref={ref}
      role="dialog"
      aria-label={label}
      className="absolute top-14 right-4 z-app-player-popover w-[720px] max-w-[calc(100%-2rem)] max-h-[calc(100%-4.5rem)] overflow-y-auto p-4 sm:p-5"
    >
      {children}
    </AppPopover>
  );
});
export const EqualizerFloatingSurface = forwardRef<
  HTMLDialogElement,
  { children: ReactNode; label: string }
>(function EqualizerFloatingSurface({ children, label }, ref) {
  return (
    <dialog
      open
      ref={ref}
      aria-label={label}
      className="crate-overlay-surface z-app-player-drawer fixed left-auto m-0 bottom-[calc(var(--listen-mobile-bottom-chrome-height,0px)+0.75rem)] right-3 w-[min(calc(100vw-1.5rem),720px)] max-h-[calc(100dvh-var(--listen-mobile-bottom-chrome-height,0px)-1.5rem)] overflow-y-auto rounded-panel border border-border-quiet bg-surface-overlay p-4 shadow-menu md:bottom-[92px] md:max-h-[calc(100dvh-104px)] sm:p-5"
    >
      {children}
    </dialog>
  );
});
