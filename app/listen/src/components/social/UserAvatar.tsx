import type { ReactNode } from "react";

import { EntityAvatar, type EntityAvatarRing } from "@crate/ui/domain/entity";
import type { AvatarShape, AvatarSize } from "@crate/ui/primitives/Avatar";

import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";

export interface UserAvatarProps {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  size?: AvatarSize;
  shape?: AvatarShape;
  ring?: EntityAvatarRing;
  badge?: ReactNode;
  badgeLabel?: string;
  alt?: string;
  className?: string;
}

export function UserAvatar({
  name,
  avatar,
  userId,
  size = "md",
  shape = "circle",
  ring,
  badge,
  badgeLabel,
  alt,
  className,
}: UserAvatarProps) {
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(avatar, userId);

  return (
    <EntityAvatar
      src={avatarUrl}
      name={name}
      alt={alt}
      size={size}
      shape={shape}
      ring={ring}
      badge={badge}
      badgeLabel={badgeLabel}
      className={className}
      onError={handleAvatarError}
    />
  );
}
