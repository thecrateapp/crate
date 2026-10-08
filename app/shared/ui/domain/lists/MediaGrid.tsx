import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export type MediaGridDensity = "compact" | "default" | "wide";

export interface MediaGridProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  children: ReactNode;
  density?: MediaGridDensity;
  minItemWidth?: number;
}

const DENSITY_CLASS_NAME: Record<MediaGridDensity, string> = {
  compact:
    "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8",
  default:
    "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
  wide: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
};

export function MediaGrid({
  children,
  className,
  density = "default",
  minItemWidth,
  style,
  ...props
}: MediaGridProps) {
  const usesMinWidth = minItemWidth !== undefined;

  return (
    <div
      {...props}
      data-testid="media-grid"
      data-density={usesMinWidth ? undefined : density}
      className={cn(
        "grid gap-[var(--content-grid-gap)]",
        usesMinWidth ? null : DENSITY_CLASS_NAME[density],
        className,
      )}
      style={
        usesMinWidth
          ? {
              ...style,
              ["--media-grid-min" as string]: `${minItemWidth}px`,
              gridTemplateColumns:
                "repeat(auto-fill, minmax(var(--media-grid-min), 1fr))",
            }
          : style
      }
    >
      {children}
    </div>
  );
}
