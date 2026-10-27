import {
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
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
  mixBpm,
}: {
  className?: string;
  disabled?: boolean;
  jogEnabled?: boolean;
  rotorRef: RefObject<HTMLDivElement | null>;
  artwork: ReactNode;
  control: ReactNode;
  mixTone?: PlayerMixTone;
  mixBpm?: number | null;
  surfaceProps?: Omit<
    ComponentPropsWithoutRef<"div">,
    "children" | "className"
  >;
}) {
  const [ringTone, setRingTone] = useState(mixTone);
  if (mixTone && mixTone !== ringTone) setRingTone(mixTone);
  const beatSeconds =
    mixBpm != null && mixBpm >= 40 && mixBpm <= 240 ? 60 / mixBpm : undefined;
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
        >
          <span
            className="spinning-disc-mix-ring absolute -inset-px rounded-full"
            data-active={mixTone ? "" : undefined}
            data-beat={mixTone && beatSeconds ? "" : undefined}
            style={
              {
                "--mix-ring-color": ringTone
                  ? PLAYER_MIX_COLORS[ringTone]
                  : undefined,
                "--mix-ring-beat": beatSeconds ? `${beatSeconds}s` : undefined,
              } as CSSProperties
            }
          />
        </div>
        {control}
      </div>
    </div>
  );
}
