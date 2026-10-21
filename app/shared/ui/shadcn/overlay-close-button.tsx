import { forwardRef, type ButtonHTMLAttributes } from "react";

import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export const OverlayCloseButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function OverlayCloseButton(
  {
    className,
    "aria-label": label = "Close",
    type = "button",
    title,
    ...props
  },
  ref,
) {
  return (
    <TooltipHint content={title}>
      <button
        {...props}
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full bg-transparent text-text-primary/55 transition-[color,box-shadow] hover:text-accent-action-hi focus-visible:text-accent-action-hi disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <X size={CRATE_ICON_SIZE.xl} aria-hidden="true" />
      </button>
    </TooltipHint>
  );
});
