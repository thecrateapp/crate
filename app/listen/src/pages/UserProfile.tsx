import { useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { UserProfileReadState } from "./UserProfileReadState";
import { api } from "@/lib/api";

import { UserProfileContent } from "./UserProfileSections";
import type { PublicProfile } from "./user-profile-model";

export function UserProfile() {
  const { t, i18n } = useTranslation();
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const { data, loading, error, status, refetch } = useApi<PublicProfile>(
    username ? "/api/users/" + encodeURIComponent(username) + "/page" : null,
  );
  const [busy, setBusy] = useState(false);
  const isOwnProfile = Boolean(data && user?.id === data.id);

  async function handleFollowToggle() {
    if (!data || isOwnProfile || busy) return;
    setBusy(true);
    try {
      if (data.relationship_state.following) {
        await api("/api/users/" + data.id + "/follow", "DELETE");
        notify.success(
          t("userProfile.toasts.unfollowed", {
            name:
              data.display_name || data.username || t("userProfile.thisUser"),
          }),
        );
      } else {
        await api("/api/users/" + data.id + "/follow", "POST");
        notify.success(
          t("userProfile.toasts.following", {
            name:
              data.display_name || data.username || t("userProfile.thisUser"),
          }),
        );
      }
      refetch();
    } catch {
      notify.error(t("userProfile.toasts.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <UserProfileReadState
        loading={loading}
        error={!!error}
        status={status}
        onRetry={refetch}
      />
    );

  return (
    <UserProfileContent
      data={data}
      isOwnProfile={isOwnProfile}
      username={username}
      busy={busy}
      onFollowToggle={handleFollowToggle}
      locale={i18n.language}
    />
  );
}
