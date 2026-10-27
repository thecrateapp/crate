import type { ReactNode, TouchEventHandler } from "react";
import { cn } from "@crate/ui/lib/cn";

/**
 * The live dock and review scene share the same geometry. The desktop dock is frosted chrome
 * (`listen-player-shell`); on mobile the shell's glass dock slab sits behind it.
 */
export function PlayerBarFrame({
  children,
  isDesktop,
  overlayRaised = false,
  position = "dock",
  onTouchStart,
  onTouchEnd,
}: {
  children: ReactNode;
  isDesktop: boolean;
  overlayRaised?: boolean;
  position?: "dock" | "inline";
  onTouchStart?: TouchEventHandler<HTMLDivElement>;
  onTouchEnd?: TouchEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      data-testid="player-bar-frame"
      data-position={position}
      className={cn(
        "isolate h-[var(--listen-mobile-player-height)] overflow-visible md:h-(--listen-desktop-player-height)",
        position === "dock"
          ? "fixed transition-[bottom,left,right,height] duration-200 md:left-3 md:right-3"
          : "relative w-full",
        overlayRaised ? "z-app-player-overlay" : "z-app-player",
      )}
      style={
        position === "dock"
          ? {
              bottom: isDesktop
                ? "var(--listen-desktop-player-bottom-offset)"
                : "calc(var(--listen-safe-bottom) + var(--listen-mobile-bottom-dock-inset) + var(--listen-mobile-bottom-nav-content-height))",
              left: isDesktop
                ? undefined
                : "max(1rem, var(--listen-safe-left))",
              right: isDesktop
                ? undefined
                : "max(1rem, var(--listen-safe-right))",
            }
          : undefined
      }
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        aria-hidden="true"
        data-slot="player-chrome"
        className={cn(
          "pointer-events-none absolute inset-0 z-0",
          isDesktop
            ? "listen-player-shell rounded-panel"
            : "rounded-t-[2rem] rounded-b-none border border-border-subtle",
        )}
      />
      <div
        className={cn(
          "relative z-10 flex h-full items-center gap-2",
          isDesktop ? "px-3 lg:px-4" : "px-4 pt-3 pb-0.5",
        )}
      >
        {children}
      </div>
    </div>
  );
}
