import type { ReactNode } from "react";
import { cn } from "@crate/ui/lib/cn";
export function PlayerQueueFrame({
  children,
  position = "drawer",
}: {
  children: ReactNode;
  position?: "inline" | "drawer";
}) {
  return (
    <div
      data-slot="player-queue"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border-l border-border-quiet bg-surface-canvas",
        position === "drawer"
          ? "z-app-player-drawer fixed right-0 top-0 bottom-(--listen-desktop-player-clearance) w-[360px] max-w-full animate-in slide-in-from-right"
          : "relative h-full w-full",
      )}
    >
      {children}
    </div>
  );
}
