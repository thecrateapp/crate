import { UserAvatar } from "@/components/social/UserAvatar";

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
      className={className}
    />
  );
}
