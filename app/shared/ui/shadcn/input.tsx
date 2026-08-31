import * as React from "react";

import { cn } from "@crate/ui/lib/cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-border-quiet bg-surface-canvas/25 px-4 py-1 text-base text-foreground shadow-control-inset backdrop-blur-sm transition-[background-color,border-color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-primary/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary/35 focus-visible:bg-surface-canvas/35 focus-visible:shadow-focus",
        "aria-invalid:border-destructive dark:aria-invalid:border-destructive/70",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
