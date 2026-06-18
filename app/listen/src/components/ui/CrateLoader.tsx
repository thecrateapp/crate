import { useMemo } from "react";

import { cn } from "@/lib/utils";

type CrateLoaderVariant = "compact" | "page" | "screen";

const WRAPPER_CLASSES: Record<CrateLoaderVariant, string> = {
  compact: "py-12",
  page: "min-h-[min(46svh,28rem)] py-16",
  screen: "min-h-svh",
};

const MARK_CLASSES: Record<CrateLoaderVariant, string> = {
  compact: "h-24 w-24 p-[3px]",
  page: "h-32 w-32 p-1",
  screen: "h-36 w-36 p-1",
};

export const CRATE_LOADING_PHRASES = [
  "Feeding your soul",
  "Loading Crate",
  "Warming the amps",
  "Spinning up the collection",
  "Cueing the next obsession",
  "Tuning the room",
  "Checking the liner notes",
  "Dusting off the crates",
  "Finding something loud",
  "Syncing the signal",
] as const;

interface CrateLoaderProps {
  className?: string;
  label?: string;
  variant?: CrateLoaderVariant;
}

export function CrateLoader({
  className,
  label = "Loading Music.",
  variant = "page",
}: CrateLoaderProps) {
  const phrase = useMemo(() => {
    const index = Math.floor(Math.random() * CRATE_LOADING_PHRASES.length);
    return CRATE_LOADING_PHRASES[index] ?? CRATE_LOADING_PHRASES[0];
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative flex flex-col items-center justify-center gap-6 overflow-visible text-center",
        WRAPPER_CLASSES[variant],
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "group relative isolate flex shrink-0 items-center justify-center overflow-visible rounded-full",
          "bg-[conic-gradient(from_218deg,#0891b2_0deg,#22d3ee_84deg,#a5f3fc_166deg,#06b6d4_248deg,#0891b2_360deg)]",
          "shadow-[0_0_5px_rgba(34,211,238,0.3),0_0_9px_rgba(39,215,255,0.14)]",
          "brightness-110 saturate-125",
          MARK_CLASSES[variant],
        )}
      >
        <span className="pointer-events-none absolute -inset-[16px] z-0 origin-[46%_57%] animate-crate-play-aura-pulse rounded-[45%_55%_49%_51%/53%_47%_56%_44%] bg-[radial-gradient(ellipse_58%_46%_at_46%_57%,rgba(34,211,238,0.38)_0%,rgba(34,211,238,0.22)_24%,rgba(34,211,238,0.09)_42%,transparent_64%),radial-gradient(ellipse_38%_32%_at_68%_34%,rgba(165,243,252,0.22)_0%,rgba(165,243,252,0.09)_34%,transparent_66%),radial-gradient(ellipse_34%_42%_at_30%_66%,rgba(8,145,178,0.25)_0%,rgba(8,145,178,0.09)_38%,transparent_68%)] opacity-[0.72]" />
        <span className="pointer-events-none absolute inset-0 z-10 animate-crate-play-rim-pulse rounded-full bg-[conic-gradient(from_218deg,rgba(8,145,178,0.94)_0deg,rgba(34,211,238,0.98)_92deg,rgba(165,243,252,0.96)_170deg,rgba(6,182,212,0.92)_250deg,rgba(8,145,178,0.9)_360deg)]" />
        <span className="pointer-events-none absolute inset-[2px] z-20 animate-crate-play-core-pulse rounded-full bg-[#121326] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_-10px_24px_rgba(0,0,0,0.48)]" />
        <img
          src="/icons/logo.svg"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="relative z-30 h-[58%] w-[58%] select-none drop-shadow-[0_0_8px_rgba(103,232,249,0.42)]"
        />
      </div>
      <p className="font-sans text-[0.9375rem] font-semibold tracking-[0.055em] text-cyan-50/80">
        {phrase}
        <span
          className="inline-flex w-[1.35em] justify-start"
          aria-hidden="true"
        >
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              aria-hidden="true"
              data-testid="crate-loader-dot"
              className="animate-crate-loader-dot-bounce"
              style={{ animationDelay: `${index * 140}ms` }}
            >
              .
            </span>
          ))}
        </span>
      </p>
      <span className="sr-only">{label}</span>
    </div>
  );
}
