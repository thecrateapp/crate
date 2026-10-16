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
        "crate-form-switch peer disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="crate-form-switch-thumb pointer-events-none block"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
export type { SwitchProps, SwitchSize };
