import { useTranslation } from "react-i18next";
import { Star } from "@crate/ui/icons";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  ProfileMetric,
  ProfileMetricsGrid,
} from "../components/social/ProfileMetric";
import {
  badgeTone,
  formatMinutes,
  type PublicProfile,
} from "./user-profile-model";
export function ProfileTasteSummary({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  const stats = data.stats;
  return (
    <div className="grid min-w-0 gap-6">
      <ProfileMetricsGrid>
        <ProfileMetric
          label={t("userProfile.stats.plays30d")}
          value={stats?.plays_30d ?? "—"}
        />
        <ProfileMetric
          label={t("userProfile.stats.time30d")}
          value={stats ? formatMinutes(stats.minutes_30d, t) : "—"}
        />
        <ProfileMetric
          label={t("userProfile.stats.adds")}
          value={stats?.contributions ?? "—"}
        />
      </ProfileMetricsGrid>
      <div className="grid min-w-0 gap-6 sm:grid-cols-3">
        <FormField kind="group" label={t("userProfile.topSound")}>
          <div className="grid min-w-0 gap-2">
            <div className="wrap-anywhere font-display text-lg font-semibold text-text-primary">
              {data.top_genre?.name || t("userProfile.stillMapping")}
            </div>
            <MonoLabel className="wrap-anywhere">
              {data.top_genre
                ? t("userProfile.topGenreStats", {
                    plays: t("common.playCount", {
                      count: data.top_genre.play_count,
                    }),
                    duration: formatMinutes(data.top_genre.minutes_listened, t),
                  })
                : t("userProfile.needsMoreSignal")}
            </MonoLabel>
          </div>
        </FormField>
        <div className="min-w-0 sm:col-span-2">
          <FormField kind="group" label={t("userProfile.badges.title")}>
            <div className="flex min-w-0 flex-wrap gap-2">
              {data.badges?.length ? (
                data.badges.map((badge) => (
                  <InfoBadge
                    key={badge.key}
                    icon={Star}
                    tone={badgeTone(badge.tone)}
                  >
                    {badge.label}
                  </InfoBadge>
                ))
              ) : (
                <p className="text-sm text-text-muted">
                  {t("userProfile.badges.empty")}
                </p>
              )}
            </div>
          </FormField>
        </div>
      </div>
    </div>
  );
}
