import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import { UserRow } from "@/components/social/UserRow";

import { type PublicProfile } from "./user-profile-model";

export function UserProfileNetwork({ data }: { data: PublicProfile }) {
  return (
    <section className="space-y-6">
      <UserProfilePeopleList
        titleKey="people.followers"
        emptyKey="userProfile.followers.empty"
        seeAllPath={
          data.username ? "/users/" + data.username + "/followers" : null
        }
        items={data.followers_preview || []}
        itemKeyPrefix="follower"
      />
      <UserProfilePeopleList
        titleKey="people.following"
        emptyKey="userProfile.following.empty"
        seeAllPath={
          data.username ? "/users/" + data.username + "/following" : null
        }
        items={data.following_preview || []}
        itemKeyPrefix="following"
      />
    </section>
  );
}

function UserProfilePeopleList({
  titleKey,
  emptyKey,
  seeAllPath,
  items,
  itemKeyPrefix,
}: {
  titleKey: "people.followers" | "people.following";
  emptyKey: "userProfile.followers.empty" | "userProfile.following.empty";
  seeAllPath: string | null;
  items: PublicProfile["followers_preview"];
  itemKeyPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">
          {t(titleKey)}
        </h2>
        {seeAllPath ? (
          <Link to={seeAllPath} className="link-accent text-xs">
            {t("userProfile.seeAll")}
          </Link>
        ) : null}
      </div>
      <div className="mt-4 space-y-3">
        {items.slice(0, 6).map((item) => (
          <UserRow
            key={itemKeyPrefix + "-" + item.id}
            user={item}
            subtitle={
              item.username ? "@" + item.username : t("userProfile.profile")
            }
            density="compact"
            className="user-profile-item"
          />
        ))}
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{t(emptyKey)}</p>
        ) : null}
      </div>
    </div>
  );
}
