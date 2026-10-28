import type { ComponentPropsWithRef } from "react";
import { cn } from "@crate/ui/lib/cn";

/** Shared by Listen's two fullscreen renderers; no decorative background layer. */
export function PlayerLyricsSurface({
  className,
  masked = false,
  ...props
}: ComponentPropsWithRef<"div"> & { masked?: boolean }) {
  return (
    <div
      {...props}
      data-slot="player-lyrics-surface"
      className={cn(
        "relative min-h-0 flex-1 overflow-y-auto",
        masked && "lyrics-mask",
        className,
      )}
    />
  );
}
