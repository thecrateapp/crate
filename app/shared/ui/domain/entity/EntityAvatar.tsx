import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";
import {
  Avatar,
  type AvatarProps,
  type AvatarShape,
  type AvatarSize,
} from "@crate/ui/primitives/Avatar";

export type EntityAvatarRing = "none" | "accent" | "subtle";

export interface EntityAvatarProps extends AvatarProps {
  shape?: AvatarShape;
  size?: AvatarSize;
  ring?: EntityAvatarRing;
  badge?: ReactNode;
  badgeLabel?: string;
}

const RING_CLASS_NAME: Record<EntityAvatarRing, string> = {
  none: "",
  accent: "ring-2 ring-accent-action ring-offset-2 ring-offset-surface-canvas",
  subtle: "ring-1 ring-border-subtle",
};

export function EntityAvatar({
  shape = "circle",
  size = "md",
  ring = "none",
  badge,
  badgeLabel,
  className,
  ...props
}: EntityAvatarProps) {
  const avatar = (
    <Avatar
      {...props}
      shape={shape}
      size={size}
      data-ring={ring === "none" ? undefined : ring}
      className={cn(RING_CLASS_NAME[ring], badge == null && className)}
    />
  );

  if (badge == null) return avatar;

  return (
    <span
      data-slot="entity-avatar"
      className={cn("relative inline-flex shrink-0", className)}
    >
      {avatar}
      <span
        data-slot="entity-avatar-badge"
        aria-label={badgeLabel}
        role={badgeLabel ? "img" : undefined}
        className="absolute -bottom-0.5 -right-0.5 inline-flex"
      >
        {badge}
      </span>
    </span>
  );
}
