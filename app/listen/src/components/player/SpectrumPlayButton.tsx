import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

type SpectrumPlayButtonSize = "sm" | "md" | "lg";

interface SpectrumPlayButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
  size?: SpectrumPlayButtonSize;
}

const sizeClasses: Record<SpectrumPlayButtonSize, string> = {
  sm: "h-9 w-9 p-[2px]",
  md: "h-12 w-12 p-[2px]",
  lg: "h-16 w-16 p-[3px]",
};

export const SpectrumPlayButton = forwardRef<
  HTMLButtonElement,
  SpectrumPlayButtonProps
>(function SpectrumPlayButton(
  {
    active = false,
    children,
    className,
    size = "md",
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-active={active ? "true" : "false"}
      className={cn(
        "group relative z-30 isolate flex shrink-0 items-center justify-center overflow-visible rounded-full",
        "bg-[conic-gradient(from_218deg,#0891b2_0deg,#22d3ee_84deg,#a5f3fc_166deg,#06b6d4_248deg,#0891b2_360deg)]",
        "shadow-[0_0_5px_rgba(34,211,238,0.3),0_0_9px_rgba(39,215,255,0.14)]",
        "transition-[transform,filter,box-shadow] duration-200 hover:scale-105 active:scale-95 data-[active=true]:brightness-110 data-[active=true]:saturate-125 data-[active=true]:shadow-[0_0_7px_rgba(34,211,238,0.38),0_0_18px_rgba(39,215,255,0.2)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080812]",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -inset-[16px] z-0 origin-[46%_57%] rounded-[45%_55%_49%_51%/53%_47%_56%_44%] bg-[radial-gradient(ellipse_58%_46%_at_46%_57%,rgba(34,211,238,0.38)_0%,rgba(34,211,238,0.22)_24%,rgba(34,211,238,0.09)_42%,transparent_64%),radial-gradient(ellipse_38%_32%_at_68%_34%,rgba(165,243,252,0.22)_0%,rgba(165,243,252,0.09)_34%,transparent_66%),radial-gradient(ellipse_34%_42%_at_30%_66%,rgba(8,145,178,0.25)_0%,rgba(8,145,178,0.09)_38%,transparent_68%)] opacity-[0.62] transition-opacity duration-200 group-hover:opacity-[0.76] group-data-[active=true]:opacity-[0.72]",
          active && "animate-crate-play-aura-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 z-10 rounded-full bg-[conic-gradient(from_218deg,rgba(8,145,178,0.94)_0deg,rgba(34,211,238,0.98)_92deg,rgba(165,243,252,0.96)_170deg,rgba(6,182,212,0.92)_250deg,rgba(8,145,178,0.9)_360deg)]",
          active && "animate-crate-play-rim-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-[2px] z-20 rounded-full bg-[#121326] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_-10px_24px_rgba(0,0,0,0.48)]",
          active && "animate-crate-play-core-pulse",
        )}
      />
      <span className="relative z-30 flex h-full w-full items-center justify-center rounded-full text-white drop-shadow-[0_0_4px_rgba(255,255,255,0.35)]">
        {children}
      </span>
    </button>
  );
});
