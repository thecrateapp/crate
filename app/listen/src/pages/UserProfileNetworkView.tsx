import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@crate/ui/domain/lists";
import { SectionActionLabel } from "@crate/ui/domain/lists/SectionHeader";
import { ProfileSection } from "../components/social/ProfileSection";
import type { PublicProfile, UserListItem } from "./user-profile-model";
export function UserProfileNetworkView({
  data,
  renderUser,
}: {
  data: PublicProfile;
  renderUser: (user: UserListItem) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid min-w-0 gap-8">
      {(["followers", "following"] as const).map((mode) => {
        const items =
          (mode === "followers"
            ? data.followers_preview
            : data.following_preview) || [];
        return (
          <ProfileSection
            key={mode}
            title={t(
              mode === "followers" ? "people.followers" : "people.following",
            )}
            action={
              data.username ? (
                <Link
                  className="link-accent inline-flex min-h-11 items-center"
                  to={`/users/${encodeURIComponent(data.username)}/${mode}`}
                >
                  <SectionActionLabel>{t("common.viewAll")}</SectionActionLabel>
                </Link>
              ) : undefined
            }
          >
            {items.length ? (
              <div className="grid min-w-0 divide-y divide-border-quiet">
                {items.slice(0, 6).map((user) => (
                  <div key={user.id}>{renderUser(user)}</div>
                ))}
              </div>
            ) : (
              <EmptyState
                message={t(
                  mode === "followers"
                    ? "userProfile.followers.empty"
                    : "userProfile.following.empty",
                )}
              />
            )}
          </ProfileSection>
        );
      })}
    </div>
  );
}
