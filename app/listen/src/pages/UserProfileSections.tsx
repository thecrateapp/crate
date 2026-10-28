import { UserProfileAvatar } from "./UserProfileAvatar";
import { UserProfileLibrary } from "./UserProfileLibrarySections";
import { UserProfileNetwork } from "./UserProfileNetworkSections";
import { UserProfileView } from "./UserProfileView";
import type { PublicProfile } from "./user-profile-model";
export { UserProfileHero, UserProfileMatch } from "./UserProfileHeroSections";
export { UserProfileLibrary } from "./UserProfileLibrarySections";
export { UserProfileNetwork } from "./UserProfileNetworkSections";
export function UserProfileContent(props: {
  data: PublicProfile;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
  locale: string;
}) {
  return (
    <UserProfileView
      {...props}
      avatar={
        <UserProfileAvatar
          name={props.data.display_name || props.data.username || ""}
          avatar={props.data.avatar}
          userId={props.data.id}
        />
      }
      library={<UserProfileLibrary data={props.data} />}
      network={<UserProfileNetwork data={props.data} />}
    />
  );
}
