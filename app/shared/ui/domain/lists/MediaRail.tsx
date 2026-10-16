import type { ComponentPropsWithoutRef, ReactNode } from "react";

import {
  MEDIA_RAIL_BASE_CLASS_NAME,
  MEDIA_RAIL_COLUMNS_CLASS_NAME,
} from "@crate/ui/lib/media-layout";
import { cn } from "@crate/ui/lib/cn";

export type MediaRailFit = "content" | "columns";

export interface MediaRailProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> {
  children: ReactNode;
  fit?: MediaRailFit;
  label?: string;
  labelledBy?: string;
}

export function MediaRail({
  children,
  className,
  fit = "content",
  label,
  labelledBy,
  ...props
}: MediaRailProps) {
  return (
    <div
      {...props}
      role={label || labelledBy ? "region" : props.role}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-testid="media-rail"
      data-rail-fit={fit}
      className={cn(
        MEDIA_RAIL_BASE_CLASS_NAME,
        fit === "columns" ? MEDIA_RAIL_COLUMNS_CLASS_NAME : "flex",
        className,
      )}
    >
      {children}
    </div>
  );
}
