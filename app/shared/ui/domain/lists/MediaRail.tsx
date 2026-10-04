import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export type MediaRailFit = "content" | "columns";

export interface MediaRailProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  children: ReactNode;
  fit?: MediaRailFit;
  label?: string;
  labelledBy?: string;
}

const COLUMNS_CLASS_NAME =
  "grid grid-flow-col auto-cols-[var(--content-rail-column-2)] sm:auto-cols-[var(--content-rail-column-3)] md:auto-cols-[var(--content-rail-column-4)] lg:auto-cols-[var(--content-rail-column-5)] xl:auto-cols-[var(--content-rail-column-6)] 2xl:auto-cols-[var(--content-rail-column-7)]";

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
        "hide-rail-scrollbar snap-x snap-mandatory gap-[var(--content-rail-gap)] overflow-x-auto overflow-y-hidden pb-2 transform-gpu will-change-scroll [&>*]:shrink-0",
        fit === "columns" ? COLUMNS_CLASS_NAME : "flex",
        className,
      )}
    >
      {children}
    </div>
  );
}
