import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import {
  APP_DROPDOWN_SURFACE,
  APP_POPOVER_SURFACE,
} from "../primitives/AppPopover";
import { cn } from "@crate/ui/lib/cn";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  layer = "popover",
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  layer?: "popover" | "dropdown";
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          `${
            layer === "dropdown" ? APP_DROPDOWN_SURFACE : APP_POPOVER_SURFACE
          } w-72 p-4 outline-hidden`,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
