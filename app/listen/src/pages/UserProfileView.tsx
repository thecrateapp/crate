import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { UserProfileHero } from "./UserProfileHero";
import { UserProfileMatch } from "./UserProfileMatch";
import type { PublicProfile } from "./user-profile-model";
export function UserProfileView({
  data,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
  locale,
  library,
  network,
  avatar,
}: {
  avatar: ReactNode;
  data: PublicProfile;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
  locale: string;
  library: ReactNode;
  network: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid min-w-0 gap-8">
      <UserProfileHero
        avatar={avatar}
        data={data}
        displayName={
          data.display_name || data.username || t("people.unknownUser")
        }
        isOwnProfile={isOwnProfile}
        username={username}
        busy={busy}
        onFollowToggle={onFollowToggle}
        locale={locale}
      />
      <UserProfileMatch data={data} isOwnProfile={isOwnProfile} />
      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-2">
        {library}
        {network}
      </div>
    </div>
  );
}
