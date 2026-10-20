import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CRATE_ICON_SIZE,
  UserPlus,
  UserRoundCheck,
  UserCheck,
} from "@crate/ui/icons";
import { PageHeader } from "@crate/ui/domain/navigation";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import type { ReactNode } from "react";
import { formatJoinedDate, type PublicProfile } from "./user-profile-model";
import {
  ProfileAffinity,
  ProfileRelationshipStats,
} from "./UserProfileRelationships";
import { ProfileTasteSummary } from "./UserProfileTaste";

export function UserProfileHero({
  data,
  displayName,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
  locale,
  avatar,
}: {
  avatar: ReactNode;
  data: PublicProfile;
  displayName: string;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const handle = data.username || username;
  const joined =
    formatJoinedDate(data.joined_at, locale) ?? t("userProfile.recently");
  return (
    <Card as="section" aria-label={displayName}>
      <CardContent className="grid gap-6">
        <PageHeader
          title={displayName}
          actions={<ProfileAffinity data={data} />}
          subtitle={data.bio}
          artwork={avatar}
          eyebrow={
            data.relationship_state.is_friend && !isOwnProfile ? (
              <InfoBadge icon={UserCheck}>{t("people.friends")}</InfoBadge>
            ) : undefined
          }
          meta={
            <div className="grid gap-2">
              <span className="text-sm text-text-muted">
                {data.username ? `@${data.username}` : t("people.noUsername")}
              </span>
              <MonoLabel>{t("userProfile.joined", { date: joined })}</MonoLabel>
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline">
            <Link
              to={
                isOwnProfile
                  ? "/stats"
                  : handle
                    ? `/users/${encodeURIComponent(handle)}/stats`
                    : "/people"
              }
            >
              <BarChart3 size={CRATE_ICON_SIZE.sm} />
              {t("userProfile.actions.viewListeningDna")}
            </Link>
          </Button>
          {isOwnProfile ? (
            <Button asChild variant="outline">
              <Link to="/settings?tab=account">
                {t("userProfile.actions.editAccount")}
              </Link>
            </Button>
          ) : (
            <Button
              variant={
                data.relationship_state.following ? "outline" : "default"
              }
              loading={busy}
              onClick={onFollowToggle}
            >
              {busy ? null : data.relationship_state.following ? (
                <UserRoundCheck size={CRATE_ICON_SIZE.sm} />
              ) : (
                <UserPlus size={CRATE_ICON_SIZE.sm} />
              )}
              {t(
                data.relationship_state.following
                  ? "common.following"
                  : "common.follow",
              )}
            </Button>
          )}
        </div>
        <ProfileRelationshipStats data={data} />
        <ProfileTasteSummary data={data} />
      </CardContent>
    </Card>
  );
}
