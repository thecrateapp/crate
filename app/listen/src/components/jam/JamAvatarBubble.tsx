import { UserAvatar } from "@/components/social/UserAvatar";
import { cn } from "@/lib/utils";

export function JamAvatarBubble({
  name,
  avatar,
  userId,
  size = "md",
  className,
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <UserAvatar
      name={name}
      avatar={avatar}
      userId={userId}
      alt=""
      className={cn(
        size === "sm" ? "size-9" : "size-11",
        "jam-avatar-fallback text-xs",
        className,
      )}
    />
  );
}
