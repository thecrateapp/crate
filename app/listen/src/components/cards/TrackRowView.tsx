import type { ComponentPropsWithRef } from "react";
import { cn } from "@crate/ui/lib/cn";

export interface TrackRowViewProps extends ComponentPropsWithRef<"div"> {
  active?: boolean;
  selected?: boolean;
  disabled?: boolean;
  density?: "default" | "compact";
}

// The production frame, reused by the isolated review. Player/menu controllers stay in TrackRow.
export function TrackRowView({
  active = false,
  selected = false,
  disabled = false,
  density = "default",
  className,
  role = "row",
  tabIndex,
  ...props
}: TrackRowViewProps) {
  return (
    <div
      {...props}
      role={role}
      tabIndex={disabled ? -1 : (tabIndex ?? 0)}
      aria-current={active ? "true" : undefined}
      data-active={active}
      data-selected={selected}
      data-disabled={disabled}
      data-density={density}
      className={cn(
        "item-action-target group track-row flex items-center gap-[var(--content-row-gap)] transition-colors",
        density === "compact"
          ? "px-2 py-1.5"
          : "px-3 py-[var(--content-row-padding-y)]",
        className,
      )}
    />
  );
}
