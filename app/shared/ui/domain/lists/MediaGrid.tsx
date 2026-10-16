import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

import {
  MEDIA_GRID_BASE_CLASS_NAME,
  MEDIA_GRID_DENSITY_CLASS_NAME,
  type MediaGridDensity,
} from "@crate/ui/lib/media-layout";
export type { MediaGridDensity } from "@crate/ui/lib/media-layout";

export interface MediaGridProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> {
  children: ReactNode;
  density?: MediaGridDensity;
  minItemWidth?: number;
}

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
        MEDIA_GRID_BASE_CLASS_NAME,
        usesMinWidth ? null : MEDIA_GRID_DENSITY_CLASS_NAME[density],
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
