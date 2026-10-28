import type { ComponentPropsWithRef, ReactNode } from "react";

import {
  MEDIA_RAIL_BASE_CLASS_NAME,
  MEDIA_RAIL_COLUMNS_CLASS_NAME,
} from "@crate/ui/lib/media-layout";
import { cn } from "@crate/ui/lib/cn";

export type MediaRailFit = "content" | "columns";

export interface MediaRailProps
  extends Omit<ComponentPropsWithRef<"div">, "children"> {
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
  const name = label ?? props["aria-label"];
  const heading = labelledBy ?? props["aria-labelledby"];
  return (
    <div
      {...props}
      role={props.role ?? (name || heading ? "region" : undefined)}
      aria-label={name}
      aria-labelledby={heading}
      tabIndex={props.tabIndex ?? (name || heading ? 0 : undefined)}
      data-slot="media-rail"
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
