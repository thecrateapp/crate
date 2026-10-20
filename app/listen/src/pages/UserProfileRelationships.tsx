import { useTranslation } from "react-i18next";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  ProfileMetric,
  ProfileMetricsGrid,
} from "../components/social/ProfileMetric";
import { affinityBandLabel, type PublicProfile } from "./user-profile-model";
export function ProfileRelationshipStats({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  const profile = data.username
    ? `/users/${encodeURIComponent(data.username)}`
    : "/people";
  return (
    <ProfileMetricsGrid>
      <ProfileMetric
        label={t("people.followers")}
        value={data.followers_count}
        to={data.username ? `${profile}/followers` : "/people"}
      />
      <ProfileMetric
        label={t("people.following")}
        value={data.following_count}
        to={data.username ? `${profile}/following` : "/people"}
      />
      <ProfileMetric label={t("people.friends")} value={data.friends_count} />
    </ProfileMetricsGrid>
  );
}

export function ProfileAffinity({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <div data-slot="profile-affinity" className="grid min-w-0 gap-2">
      <StatNumber
        value={data.affinity_score}
        unit="%"
        label={t("userProfile.affinity")}
        size="md"
      />
      <MonoLabel tone="accent">
        {affinityBandLabel(data.affinity_band, t)}
      </MonoLabel>
    </div>
  );
}
