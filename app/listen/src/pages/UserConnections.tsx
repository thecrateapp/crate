import { useLocation, useParams } from "react-router";
import { UserRow } from "../components/social/UserRow";
import { useApi } from "@/hooks/use-api";
import type { UserListItem } from "./user-profile-model";
import { UserConnectionsView } from "./UserConnectionsView";
export function UserConnections() {
  const { username } = useParams<{ username: string }>();
  const location = useLocation();
  const mode = location.pathname.endsWith("/following")
    ? "following"
    : "followers";
  const { data, loading, error, refetch } = useApi<UserListItem[]>(
    username
      ? `/api/users/${encodeURIComponent(username)}/${mode}?limit=200`
      : null,
  );
  return (
    <UserConnectionsView
      renderUser={(user) => <UserRow user={user} />}
      username={username}
      mode={mode}
      data={data}
      loading={loading}
      error={!!error}
      onRetry={refetch}
    />
  );
}
