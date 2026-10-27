import { memo, type ComponentProps, type ComponentType } from "react";
import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { BADGE_TONE_CLASS, type InfoBadgeTone } from "./InfoBadge";
export type FilterChipProps = Omit<ComponentProps<"button">, "aria-pressed"> & {
  active?: boolean;
  variant?: "toggle" | "action";
  tone?: InfoBadgeTone;
  icon?: ComponentType<{ size: number }>;
};

/** A filter toggle (aria-pressed), or an explicitly requested ordinary action. */
export const FilterChip = memo(function FilterChip({
  children,
  active = false,
  variant = "toggle",
  tone,
  icon: Icon,
  className,
  ...props
}: FilterChipProps) {
  const pressed = variant === "toggle" && active;
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      aria-pressed={variant === "toggle" ? active : undefined}
      data-slot="chip"
      data-state={pressed ? "active" : "inactive"}
      data-tone={tone}
      className={cn(
        "crate-form-chip inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border px-3 py-1 font-mono font-normal text-filter-chip tracking-chip disabled:cursor-not-allowed disabled:opacity-[var(--disabled-opacity)]",
        !pressed && tone && BADGE_TONE_CLASS[tone],
        className,
      )}
    >
      {Icon ? <Icon size={CRATE_ICON_SIZE.micro} aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
