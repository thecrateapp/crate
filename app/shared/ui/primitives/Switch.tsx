import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@crate/ui/lib/cn";

type SwitchSize = "sm" | "md";

interface SwitchProps
  extends React.ComponentProps<typeof SwitchPrimitive.Root> {
  size?: SwitchSize;
}

function Switch({ className, size = "md", ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-border-subtle bg-surface-control outline-none transition-[background-color,border-color,box-shadow] focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent-action data-[state=checked]:bg-accent-action aria-invalid:border-state-danger",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-text-primary shadow-control-inset transition-transform data-[state=checked]:bg-accent-action-foreground data-[state=unchecked]:translate-x-0.5",
          size === "sm"
            ? "size-4 data-[state=checked]:translate-x-[18px]"
            : "size-5 data-[state=checked]:translate-x-[22px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
export type { SwitchProps, SwitchSize };
