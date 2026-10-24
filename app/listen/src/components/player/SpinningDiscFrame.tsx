import type { ComponentPropsWithoutRef, ReactNode, RefObject } from "react";
import { cn } from "@crate/ui/lib/cn";
import {
  PLAYER_MIX_COLORS,
  type PlayerMixTone,
} from "./player-mix-presentation";

// Visual frame shared by the real disc controller and its isolated motion review.
// Managed artwork, playback and pointer/jog decisions remain injected by Listen.
export function SpinningDiscFrame({
  className,
  disabled = false,
  jogEnabled = false,
  rotorRef,
  artwork,
  control,
  surfaceProps,
  mixTone,
}: {
  className?: string;
  disabled?: boolean;
  jogEnabled?: boolean;
  rotorRef: RefObject<HTMLDivElement | null>;
  artwork: ReactNode;
  control: ReactNode;
  mixTone?: PlayerMixTone;
  surfaceProps?: Omit<
    ComponentPropsWithoutRef<"div">,
    "children" | "className"
  >;
}) {
  return (
    <div
      className={cn(
        "relative",
        className,
        disabled && "pointer-events-none grayscale opacity-60",
      )}
    >
      <div className="spinning-disc-ambient absolute inset-[7%] rounded-full blur-3xl opacity-80" />
      <div
        {...surfaceProps}
        data-testid="spinning-disc-jog-surface"
        className={cn(
          "spinning-disc-surface relative aspect-square w-full rounded-full",
          jogEnabled && "cursor-grab touch-none active:cursor-grabbing",
        )}
      >
        <div
          ref={rotorRef}
          className="spinning-disc-rotor absolute inset-[5.5%] overflow-hidden rounded-full will-change-transform"
        >
          {artwork}
        </div>
        <div
          className="spinning-disc-overlay pointer-events-none absolute inset-[2%] rounded-full"
          data-mix-tone={mixTone}
          style={
            mixTone ? { borderColor: PLAYER_MIX_COLORS[mixTone] } : undefined
          }
        />
        {control}
      </div>
    </div>
  );
}
