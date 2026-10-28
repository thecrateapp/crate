import type { TFunction } from "i18next";
import { PageHeader } from "@crate/ui/domain/navigation";
import type { ReactNode } from "react";
import { EntityAvatar } from "@crate/ui/domain/entity";
import { UserRowView } from "../components/social/UserRowView";
import { ProfileMetric } from "../components/social/ProfileMetric";
import type { PeopleViewer, SocialSummary } from "./people-types";

export function PeopleSummary({
  data,
  t,
  user,
  avatar,
}: {
  avatar?: ReactNode;
  data: SocialSummary | null | undefined;
  t: TFunction;
  user: PeopleViewer | null;
}) {
  const username = data?.profile.username || user?.username;
  const profile = username
    ? `/users/${encodeURIComponent(username)}`
    : "/settings?tab=account";
  const name =
    data?.profile.display_name || user?.name || t("people.fallback.you");
  return (
    <div className="grid gap-6">
      <PageHeader title={t("people.title")} subtitle={t("people.subtitle")} />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-6">
        <div className="min-w-0 flex-1">
          <UserRowView
            title={name}
            subtitle={
              username ? `@${username}` : t("people.summary.setUsername")
            }
            meta={t("people.summary.yourProfile")}
            href={profile}
            leading={avatar ?? <EntityAvatar name={name} alt="" size="lg" />}
          />
        </div>
        <div className="grid grid-cols-3 gap-6">
          <ProfileMetric
            label={t("people.followers")}
            value={data?.followers_count ?? "—"}
            to={username ? `${profile}/followers` : "/people"}
          />
          <ProfileMetric
            label={t("people.following")}
            value={data?.following_count ?? "—"}
            to={username ? `${profile}/following` : "/people"}
          />
          <ProfileMetric
            label={t("people.friends")}
            value={data?.friends_count ?? "—"}
          />
        </div>
      </div>
    </div>
  );
}
