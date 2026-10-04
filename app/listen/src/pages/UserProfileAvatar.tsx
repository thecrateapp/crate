import { UserAvatar } from "@/components/social/UserAvatar";
import { cn } from "@/lib/utils";

export function UserProfileAvatar({
  name,
  avatar,
  userId,
  className,
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  className?: string;
}) {
  return (
    <UserAvatar
      name={name}
      avatar={avatar}
      userId={userId}
      size="xl"
      className={cn("user-profile-avatar-placeholder", className)}
    />
  );
}
