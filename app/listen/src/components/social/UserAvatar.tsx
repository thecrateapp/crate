import { useCallback, type ReactNode } from "react";

import { EntityAvatar, type EntityAvatarRing } from "@crate/ui/domain/entity";
import type {
  AvatarImageRenderProps,
  AvatarShape,
  AvatarSize,
} from "@crate/ui/primitives/Avatar";

import { CrateImage } from "@/components/artwork/CrateImage";
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
  const renderImage = useCallback(
    (image: AvatarImageRenderProps) => (
      <CrateImage
        src={image.src}
        alt={image.alt}
        loading="lazy"
        decoding="async"
        className={image.className}
        onError={() => {
          image.onError();
          handleAvatarError();
        }}
      />
    ),
    [handleAvatarError],
  );

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
      renderImage={renderImage}
    />
  );
}
