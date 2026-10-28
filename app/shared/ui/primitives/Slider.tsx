import type { ComponentProps } from "react";
import { cn } from "@crate/ui/lib/cn";

export type SliderProps = Omit<ComponentProps<"input">, "type">;

/** General form range. Native constraints, keyboard and form submission stay intact. */
export function Slider({ className, ...props }: SliderProps) {
  return (
    <input
      {...props}
      type="range"
      data-slot="slider"
      className={cn(
        "crate-form-slider w-full disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}
