import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@crate/ui/lib/cn";

type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive.Root>;

function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-interactive bg-surface-control text-accent-action-foreground outline-none transition-[background-color,border-color,box-shadow] focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent-action data-[state=checked]:bg-accent-action data-[state=indeterminate]:border-accent-action data-[state=indeterminate]:bg-accent-action aria-invalid:border-state-danger",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/checkbox-indicator flex items-center justify-center text-current"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-3.5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <path
            className="group-data-[state=indeterminate]/checkbox-indicator:hidden"
            d="M3.5 8.5l3 3 6-7"
          />
          <path
            className="hidden group-data-[state=indeterminate]/checkbox-indicator:block"
            d="M4 8h8"
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
export type { CheckboxProps };
