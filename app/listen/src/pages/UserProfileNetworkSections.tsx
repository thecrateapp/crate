import { UserRow } from "../components/social/UserRow";
import { UserProfileNetworkView } from "./UserProfileNetworkView";
import type { PublicProfile } from "./user-profile-model";
export function UserProfileNetwork({ data }: { data: PublicProfile }) {
  return (
    <UserProfileNetworkView
      data={data}
      renderUser={(user) => <UserRow user={user} density="compact" />}
    />
  );
}
