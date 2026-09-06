import { CrateImage } from "@/components/artwork/CrateImage";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";

import { initials } from "@/pages/jam-session-utils";

export function JamAvatarBubble({
  name,
  avatar,
  userId,
  size = "md",
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "h-9 w-9 text-[11px]" : "h-11 w-11 text-xs";
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(avatar, userId);
  if (avatarUrl) {
    return (
      <CrateImage
        src={avatarUrl}
        alt=""
        onError={handleAvatarError}
        className={`${sizeClass} jam-avatar shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} jam-avatar-fallback flex shrink-0 items-center justify-center rounded-full font-semibold`}
    >
      {initials(name)}
    </div>
  );
}
