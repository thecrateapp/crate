import { type ComponentProps } from "react";
import {
  InfoBadge,
  type InfoBadgeProps,
  type InfoBadgeTone,
  type InfoBadgeSurface,
} from "./InfoBadge";
import { FilterChip, type FilterChipProps } from "./FilterChip";

/** Compatibility imports. New consumers use InfoBadge / FilterChip by role. */
export type CrateBadgeTone = InfoBadgeTone;
export type CrateBadgeSurface = InfoBadgeSurface;
export type CrateBadgeSize = "sm" | "md";

export function CrateBadge({
  size: _size,
  ...props
}: InfoBadgeProps & { size?: CrateBadgeSize }) {
  void _size; // Historical sizes intentionally share the approved 24px recipe.
  return <InfoBadge {...props} />;
}
export const CrateChip = InfoBadge;

interface CratePillProps
  extends Omit<ComponentProps<typeof FilterChip>, "variant" | "onClick"> {
  variant?: "toggle" | "action" | "static";
  onClick?: () => void;
}
export function CratePill({
  variant,
  onClick,
  active,
  children,
  icon,
  tone,
  className,
  disabled,
}: CratePillProps) {
  const mode = variant ?? (onClick ? "toggle" : "static");
  if (mode === "static")
    return (
      <InfoBadge icon={icon} tone={tone} className={className}>
        {children}
      </InfoBadge>
    );
  const props: FilterChipProps = {
    variant: mode,
    onClick,
    active,
    children,
    icon,
    tone,
    className,
    disabled,
  };
  return <FilterChip {...props} />;
}
