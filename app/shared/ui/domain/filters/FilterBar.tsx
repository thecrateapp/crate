import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export interface FilterBarProps {
  search?: ReactNode;
  sort?: ReactNode;
  chips?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  label?: string;
  chipsLabel?: string;
  className?: string;
}

export function FilterBar({
  search,
  sort,
  chips,
  leading,
  actions,
  label,
  chipsLabel,
  className,
}: FilterBarProps) {
  const hasControls = Boolean(leading || search || sort || actions);

  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      data-testid="filter-bar"
      className={cn("flex flex-col gap-3", className)}
    >
      {hasControls ? (
        <div className="flex flex-wrap items-center gap-2">
          {leading ? (
            <div className="flex shrink-0 items-center gap-2">{leading}</div>
          ) : null}
          {search ? (
            <div className="min-w-44 flex-1" data-slot="filter-search">
              {search}
            </div>
          ) : null}
          {sort ? (
            <div
              className="flex shrink-0 items-center gap-2"
              data-slot="filter-sort"
            >
              {sort}
            </div>
          ) : null}
          {actions ? (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {chips ? (
        <div
          role={chipsLabel ? "group" : undefined}
          aria-label={chipsLabel}
          className="flex flex-wrap items-center gap-2"
          data-slot="filter-chips"
        >
          {chips}
        </div>
      ) : null}
    </div>
  );
}
