import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@crate/ui/lib/cn";

function Progress({
  className,
  value,
  max,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const resolvedMax =
    typeof max === "number" && !Number.isNaN(max) && max > 0 ? max : 100;
  const percent =
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= resolvedMax
      ? (value / resolvedMax) * 100
      : 0;
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn(
        "relative h-px w-full overflow-hidden rounded-md bg-accent-action/20",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-accent-action transition-transform"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
