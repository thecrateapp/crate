import { useTranslation } from "react-i18next";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { ProfileSection } from "../components/social/ProfileSection";
import type { PublicProfile } from "./user-profile-model";
export function UserProfileMatch({
  data,
  isOwnProfile,
}: {
  data: PublicProfile;
  isOwnProfile: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ProfileSection title={t("userProfile.match.title")}>
      {isOwnProfile || !data.affinity_reasons.length ? (
        <p className="text-sm leading-6 text-text-muted">
          {t(
            isOwnProfile
              ? "userProfile.match.ownProfile"
              : "userProfile.match.notEnough",
          )}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.affinity_reasons.map((reason) => (
            <InfoBadge key={reason}>{reason}</InfoBadge>
          ))}
        </div>
      )}
    </ProfileSection>
  );
}
