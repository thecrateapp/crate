import { forwardRef, type ButtonHTMLAttributes } from "react";

import { Loader2, Pause, Play } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export type PlayButtonSize = "sm" | "md" | "lg";
export type PlayButtonReveal = "hover" | "always";

const SIZE_CLASS_NAME: Record<PlayButtonSize, string> = {
  sm: "size-10",
  md: "size-11",
  lg: "size-14",
};

const ICON_SIZE: Record<PlayButtonSize, number> = {
  sm: 18,
  md: 20,
  lg: 24,
};

const HOVER_REVEAL_CLASS_NAME =
  "pointer-fine:translate-y-2 pointer-fine:opacity-0 pointer-fine:group-hover:translate-y-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:translate-y-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover/card:translate-y-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:group-focus-within/card:translate-y-0 pointer-fine:group-focus-within/card:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100";

export interface PlayButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  size?: PlayButtonSize;
  reveal?: PlayButtonReveal;
  playing?: boolean;
  loading?: boolean;
  label?: string;
  pauseLabel?: string;
}

export const PlayButton = forwardRef<HTMLButtonElement, PlayButtonProps>(
  function PlayButton(
    {
      size = "md",
      reveal = "always",
      playing = false,
      loading = false,
      label = "Play",
      pauseLabel = "Pause",
      className,
      type = "button",
      ...props
    },
    ref,
  ) {
    const iconSize = ICON_SIZE[size];
    const accessibleLabel = playing ? pauseLabel : label;

    return (
      <button
        ref={ref}
        type={type}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        aria-busy={loading || undefined}
        data-size={size}
        data-reveal={reveal}
        data-state={loading ? "loading" : playing ? "playing" : "idle"}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-action outline-none transition-[transform,opacity,background-color,box-shadow] hover:scale-105 hover:bg-accent-action-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-50",
          SIZE_CLASS_NAME[size],
          reveal === "hover" && !playing && !loading && HOVER_REVEAL_CLASS_NAME,
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2
            aria-hidden="true"
            size={iconSize}
            className="animate-spin"
          />
        ) : playing ? (
          <Pause aria-hidden="true" size={iconSize} fill="currentColor" />
        ) : (
          <Play
            aria-hidden="true"
            size={iconSize}
            fill="currentColor"
            className="ml-0.5"
          />
        )}
      </button>
    );
  },
);
