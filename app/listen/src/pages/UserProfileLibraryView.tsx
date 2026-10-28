import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@crate/ui/domain/lists";
import { ProfileSection } from "../components/social/ProfileSection";
export function UserProfileLibraryView({
  contributions,
  playlists,
  crates,
}: {
  contributions: ReactNode;
  playlists: ReactNode;
  crates: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid min-w-0 gap-8">
      <ProfileSection
        title={t("userProfile.contributions.title")}
        description={t("userProfile.contributions.subtitle")}
      >
        {contributions || (
          <EmptyState message={t("userProfile.contributions.empty")} />
        )}
      </ProfileSection>
      <ProfileSection title={t("userProfile.playlists.title")}>
        {playlists || <EmptyState message={t("userProfile.playlists.empty")} />}
      </ProfileSection>
      <ProfileSection title={t("userProfile.crates.title")}>
        {crates || <EmptyState message={t("userProfile.crates.empty")} />}
      </ProfileSection>
    </div>
  );
}
